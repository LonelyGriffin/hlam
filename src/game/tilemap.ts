import * as PIXI from "pixi.js";

export class ZLayer extends PIXI.Container {

    constructor(tilemap: PIXI.Container, zIndex: number) {
        super();
        this.tilemap = tilemap;
        this.z = zIndex;
    }

    tilemap: any;
    z: number;
    zIndex: number = 0;
    _previousLayers: number = 0; // !!!
    canvasBuffer: HTMLCanvasElement|null = null;
    _tempRender: PIXI.CanvasRenderer|null = null;
    _lastAnimationFrame: number = -1;
    layerTransform: PIXI.Matrix|null = null;

    clear() {
        var layers = this.children as Array<CompositeRectTileLayer>;
        for (var i = 0; i < layers.length; i++)
            layers[i].clear();
        this._previousLayers = 0;
    }

    cacheIfDirty() {
        var tilemap: any = this.tilemap;
        var layers = this.children as Array<CompositeRectTileLayer>;
        var modified = this._previousLayers !== layers.length;
        this._previousLayers = layers.length;
        var buf = this.canvasBuffer;
        var tempRender = this._tempRender;
        if (!buf) {
            buf = this.canvasBuffer = document.createElement('canvas');
            tempRender = this._tempRender = new PIXI.CanvasRenderer(100, 100, {view: buf});
            tempRender.context = tempRender.rootContext;
            tempRender.plugins.tilemap.dontUseTransform = true;
        }
        if (buf.width !== tilemap._layerWidth ||
            buf.height !== tilemap._layerHeight) {
            buf.width = tilemap._layerWidth;
            buf.height = tilemap._layerHeight;
            modified = true;
        }
        var i: number;
        if (!modified) {
            for (i = 0; i < layers.length; i++) {
                if (layers[i].isModified(this._lastAnimationFrame !== tilemap.animationFrame)) {
                    modified = true;
                    break;
                }
            }
        }
        this._lastAnimationFrame = tilemap.animationFrame;
        if (modified) {
            if (tilemap._hackRenderer) {
                tilemap._hackRenderer(tempRender);
            }
            if (tempRender && tempRender.context) {
                tempRender.context.clearRect(0, 0, buf.width, buf.height);
                for (i = 0; i < layers.length; i++) {
                    layers[i].clearModify();
                    layers[i].renderCanvas(tempRender);
                }
            }
        }
        this.layerTransform = this.worldTransform;
        for (i = 0; i < layers.length; i++) {
            this.layerTransform = layers[i].worldTransform;
            break;
        }
    }

    renderCanvas(renderer: PIXI.CanvasRenderer|null) {
        this.cacheIfDirty();
        var wt = this.layerTransform;
        if (wt && renderer && renderer.context && this.canvasBuffer) {
            renderer.context.setTransform(
                wt.a,
                wt.b,
                wt.c,
                wt.d,
                wt.tx * renderer.resolution,
                wt.ty * renderer.resolution
            );
            var tilemap = this.tilemap;
            renderer.context.drawImage(this.canvasBuffer, 0, 0);
        }
    }
}


function _hackSubImage(tex: PIXI.glCore.GLTexture, sprite: PIXI.Sprite, clearBuffer?: Uint8Array, clearWidth?: number, clearHeight?: number) {
    const gl = tex.gl;
    const baseTex = sprite.texture.baseTexture;
    if (clearHeight && clearWidth && clearBuffer && clearWidth > 0 && clearHeight > 0)
    {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, sprite.position.x, sprite.position.y, clearWidth, clearHeight, tex.format, tex.type, clearBuffer);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, sprite.position.x, sprite.position.y, tex.format, tex.type, baseTex.source as HTMLImageElement);
}

/*
    * Renderer for rectangle tiles.
    *
    * @class
    * @memberof PIXI.tilemap
    * @extends PIXI.ObjectRenderer
    * @param renderer {PIXI.WebGLRenderer} The renderer this sprite batch works for.
    */

export class TileRenderer extends PIXI.ObjectRenderer {

    static vbAutoincrement = 0;
    static SCALE_MODE = PIXI.SCALE_MODES.LINEAR;
    static DO_CLEAR = false;
    renderer: any;
    gl: WebGLRenderingContext|undefined = undefined;
    vbs:  { [key: string]: any; } = {};
    indices = new Uint16Array(0);
    indexBuffer: PIXI.glCore.GLBuffer|undefined = undefined;
    lastTimeCheck = 0;
    tileAnim = [0, 0];
    texLoc: Array<number> = [];

    rectShader: RectTileShader|undefined = undefined;
    boundSprites: Array<PIXI.Sprite> = [];
    glTextures: Array<PIXI.RenderTexture> = [];

    _clearBuffer: Uint8Array|undefined = undefined;

    constructor(renderer: PIXI.WebGLRenderer) {
        super(renderer)
    }

    onContextChange() {
        if (this.renderer && this.indexBuffer) {
            const gl = this.renderer.gl;
            const maxTextures = Constant.maxTextures;
    
            this.rectShader = new RectTileShader(gl, maxTextures);
            this.checkIndexBuffer(2000);
            this.rectShader.indexBuffer = this.indexBuffer;
            this.vbs = {};
            this.glTextures = [];
            this.boundSprites = [];
            this.initBounds();
        }
        
    }

    initBounds() {
        if (!this.renderer) {
            return;
        }
        const gl = this.renderer.gl;
        const maxTextures = Constant.maxTextures;
        for (let i = 0; i < maxTextures; i++) {
            const rt = PIXI.RenderTexture.create(Constant.bufferSize, Constant.bufferSize);
            rt.baseTexture.premultipliedAlpha = true;
            rt.baseTexture.scaleMode = TileRenderer.SCALE_MODE;
            rt.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;
            if (this.renderer && this.renderer.textureManager) {
                this.renderer.textureManager.updateTexture(rt);
            }

            this.glTextures.push(rt);
            const bounds = this.boundSprites;
            for (let j = 0; j < Constant.boundCountPerBuffer; j++) {
                const spr = new PIXI.Sprite();
                spr.position.x = Constant.boundSize * (j & 1);
                spr.position.y = Constant.boundSize * (j >> 1);
                bounds.push(spr);
            }
        }
    }

    bindTextures(renderer: PIXI.WebGLRenderer, shader: TilemapShader, textures: Array<PIXI.Texture>) {
        if(!this.renderer) {
            return;
        }
        
        const len = textures.length;
        const maxTextures = Constant.maxTextures;
        if (len > Constant.boundCountPerBuffer * maxTextures) {
            return;
        }
        const doClear = TileRenderer.DO_CLEAR;
        if (doClear && !this._clearBuffer) {
            this._clearBuffer = new Uint8Array(Constant.boundSize * Constant.boundSize * 4);
        }
        const glts = this.glTextures;
        const bounds = this.boundSprites;

        const oldActiveRenderTarget = this.renderer._activeRenderTarget;

        let i: number;
        for (i = 0; i < len; i++) {
            const texture = textures[i];
            if (!texture || !texture.valid) continue;
            const bs = bounds[i];
            if (!bs.texture ||
                bs.texture.baseTexture !== texture.baseTexture) {
                bs.texture = texture;
                const glt = glts[i >> 2];
                renderer.bindTexture(glt, 0, true);
                if (doClear) {
                    _hackSubImage((glt.baseTexture as any)._glTextures[renderer.CONTEXT_UID], bs, this._clearBuffer, Constant.boundSize, Constant.boundSize);
                } else {
                    _hackSubImage((glt.baseTexture as any)._glTextures[renderer.CONTEXT_UID], bs);
                }
            }
        }

        // fix in case we are inside of filter or renderTexture
        if (!oldActiveRenderTarget.root) {
            this.renderer._activeRenderTarget.frameBuffer.bind();
        }

        this.texLoc.length = 0;
        var gltsUsed = (i + 3) >> 2;
        for (i = 0; i < gltsUsed; i++) {
            //remove "i, true" after resolving a bug
            this.texLoc.push(renderer.bindTexture(glts[i], i, true))
        }

        shader.uniforms.uSamplers = this.texLoc;
    }

    checkLeaks() {
        const now = Date.now();
        const old = now - 10000;
        if (this.lastTimeCheck < old ||
            this.lastTimeCheck > now) {
            this.lastTimeCheck = now;
            const vbs = this.vbs;
            for (let key in vbs) {
                if (vbs[key].lastTimeAccess < old) {
                    this.removeVb(key);
                }
            }
        }
    }

    start() {
        if (this.renderer && this.renderer.state) {
            this.renderer.state.setBlendMode(PIXI.BLEND_MODES.NORMAL);
        }
        //sorry, nothing
    }

    getVb(id: string) {
        this.checkLeaks();
        const vb = this.vbs[id];
        if (vb) {
            vb.lastAccessTime = Date.now();
            return vb;
        }
        return null;
    }

    createVb() {
        if (!this.renderer) {
            return;
        }
        const id = ++TileRenderer.vbAutoincrement;
        const shader = this.getShader();
        const gl = this.renderer.gl;

        this.renderer.bindVao(null as any);

        const vb = PIXI.glCore.GLBuffer.createVertexBuffer(gl, null, gl.STREAM_DRAW);
        const stuff = {
            id: id,
            vb: vb,
            vao: shader.createVao(this.renderer, vb),
            lastTimeAccess: Date.now(),
            shader: shader
        };
        this.vbs[id] = stuff;
        return stuff;
    }

    removeVb(id: string) {
        if (this.vbs[id]) {
            this.vbs[id].vb.destroy();
            this.vbs[id].vao.destroy();
            delete this.vbs[id];
        }
    }

    checkIndexBuffer(size: number) {
        // the total number of indices in our array, there are 6 points per quad.
        const totalIndices = size * 6;
        let indices = this.indices;
        if (totalIndices <= indices.length) {
            return;
        }
        let len = indices.length || totalIndices;
        while (len < totalIndices) {
            len <<= 1;
        }

        indices = new Uint16Array(len);
        this.indices = indices;

        // fill the indices with the quads to draw
        for (let i = 0, j = 0; i + 5 < indices.length; i += 6, j += 4) {
            indices[i + 0] = j + 0;
            indices[i + 1] = j + 1;
            indices[i + 2] = j + 2;
            indices[i + 3] = j + 0;
            indices[i + 4] = j + 2;
            indices[i + 5] = j + 3;
        }

        if (this.indexBuffer) {
            this.indexBuffer.upload(indices);
        } else if(this.renderer) {
            let gl = this.renderer.gl;
            this.indexBuffer = PIXI.glCore.GLBuffer.createIndexBuffer(gl, this.indices, gl.STATIC_DRAW);
        }
    }

    getShader(): TilemapShader {
        return this.rectShader as any;
    }

    destroy() {
        if (!this.rectShader) {
            return;
        }
        super.destroy();
        this.rectShader.destroy();
        this.rectShader = undefined;
    }
}

PIXI.WebGLRenderer.registerPlugin('tilemap', TileRenderer);

/*
    * Renderer for rectangle tiles.
    *
    * @class
    * @memberof PIXI.tilemap
    * @extends PIXI.ObjectRenderer
    * @param renderer {PIXI.WebGLRenderer} The renderer this sprite batch works for.
    */

export class SimpleTileRenderer extends TileRenderer {

    constructor(renderer: PIXI.WebGLRenderer) {
        super(renderer)
    }

    samplerSize: Array<number> = [];

    onContextChange() {
        const gl = this.renderer.gl;
        this.rectShader = new RectTileShader(gl, 1);
        this.checkIndexBuffer(2000);
        if (this.rectShader && this.indexBuffer) {
            this.rectShader.indexBuffer = this.indexBuffer;
        }
        this.vbs = {};
    }

    bindTextures(renderer: PIXI.WebGLRenderer, shader: TilemapShader, textures: Array<PIXI.Texture>) {
        const len = textures.length;

        let i: number;
        for (i = 0; i < len; i++) {
            const texture = textures[i];

            if (!texture || !texture.valid) {
                continue;
            }

            this.texLoc[0] = renderer.bindTexture(texture, 0, true);
            shader.uniforms.uSamplers = this.texLoc;

            this.samplerSize[0] = 1.0 / texture.baseTexture.width;
            this.samplerSize[1] = 1.0 / texture.baseTexture.height;
            shader.uniforms.uSamplerSize = this.samplerSize;

            break;
        }
    }

    destroy() {
        super.destroy();
    }
}

PIXI.WebGLRenderer.registerPlugin('simpleTilemap', SimpleTileRenderer);


export function fillSamplers(shader: TilemapShader, maxTextures: number) {
    var sampleValues: Array<number> = [];
    for (var i = 0; i < maxTextures; i++)
    {
        sampleValues[i] = i;
    }
    shader.bind();
    shader.uniforms.uSamplers = sampleValues;

    var samplerSize: Array<number> = [];
    for (i = 0; i < maxTextures; i++) {
        samplerSize.push(1.0 / Constant.bufferSize);
        samplerSize.push(1.0 / Constant.bufferSize);
    }
    shader.uniforms.uSamplerSize = samplerSize;
}

export function generateFragmentSrc(maxTextures: number, fragmentSrc: string) {
    return fragmentSrc.replace(/%count%/gi, maxTextures + "")
        .replace(/%forloop%/gi, generateSampleSrc(maxTextures));
}

export function generateSampleSrc(maxTextures: number) {
    var src = '';

    src += '\n';
    src += '\n';

    src += 'if(vTextureId <= -1.0) {';
    src += '\n\tcolor = shadowColor;';
    src += '\n}';

    for (var i = 0; i < maxTextures; i++)
    {
        src += '\nelse ';

        if(i < maxTextures-1)
        {
            src += 'if(textureId == ' + i + '.0)';
        }

        src += '\n{';
        src += '\n\tcolor = texture2D(uSamplers['+i+'], textureCoord * uSamplerSize['+i+']);';
        src += '\n}';
    }

    src += '\n';
    src += '\n';

    return src;
}

var rectShaderFrag = `
varying vec2 vTextureCoord;
varying vec4 vFrame;
varying float vTextureId;
uniform vec4 shadowColor;
uniform sampler2D uSamplers[%count%];
uniform vec2 uSamplerSize[%count%];

void main(void){
   vec2 textureCoord = clamp(vTextureCoord, vFrame.xy, vFrame.zw);
   float textureId = floor(vTextureId + 0.5);

   vec4 color;
   %forloop%
   gl_FragColor = color;
}
`;

var rectShaderVert = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
attribute vec4 aFrame;
attribute vec2 aAnim;
attribute float aTextureId;

uniform mat3 projectionMatrix;
uniform vec2 animationFrame;

varying vec2 vTextureCoord;
varying float vTextureId;
varying vec4 vFrame;

void main(void){
   gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
   vec2 anim = aAnim * animationFrame;
   vTextureCoord = aTextureCoord + anim;
   vFrame = aFrame + vec4(anim, anim);
   vTextureId = aTextureId;
}
`;

export abstract class TilemapShader extends PIXI.Shader {

    maxTextures = 0;
    indexBuffer: PIXI.glCore.GLBuffer|undefined = undefined;

    constructor(gl: WebGLRenderingContext, maxTextures: number, shaderVert: string, shaderFrag: string) {
        super(gl,
            shaderVert,
            shaderFrag
        );
        this.maxTextures = maxTextures;
        fillSamplers(this, this.maxTextures);
    }

    abstract createVao(renderer: PIXI.WebGLRenderer, vb:PIXI.glCore.GLBuffer): PIXI.glCore.VertexArrayObject;
}

export class RectTileShader extends TilemapShader {
    vertSize = 11;
    vertPerQuad = 4;
    stride = this.vertSize * 4;

    constructor(gl: WebGLRenderingContext, maxTextures: number) {
        super(gl,
            maxTextures,
            rectShaderVert,
            generateFragmentSrc(maxTextures, rectShaderFrag)
        );
        fillSamplers(this, this.maxTextures);
    }

    createVao(renderer: PIXI.WebGLRenderer, vb: PIXI.glCore.GLBuffer) {
        var gl = renderer.gl;
        return renderer.createVao()
            .addIndex(this.indexBuffer as any)
            .addAttribute(vb, this.attributes.aVertexPosition, gl.FLOAT, false, this.stride, 0)
            .addAttribute(vb, this.attributes.aTextureCoord, gl.FLOAT, false, this.stride, 2 * 4)
            .addAttribute(vb, this.attributes.aFrame, gl.FLOAT, false, this.stride, 4 * 4)
            .addAttribute(vb, this.attributes.aAnim, gl.FLOAT, false, this.stride, 8 * 4)
            .addAttribute(vb, this.attributes.aTextureId, gl.FLOAT, false, this.stride, 10 * 4);
    }
}


export class RectTileLayer extends PIXI.Container {

    constructor(zIndex: number, texture: PIXI.Texture | Array<PIXI.Texture>) {
        super();
        this.initialize(zIndex, texture);
    }

    updateTransform() {
        super.displayObjectUpdateTransform()
    }

    z = 0;
    zIndex = 0;
    modificationMarker = 0;
    shadowColor = new Float32Array([0.0, 0.0, 0.0, 0.5]);
    _globalMat: PIXI.Matrix|null = null;

    pointsBuf: Array<number> = [];
    hasAnim = false;
    textures: Array<PIXI.Texture> = [];

    offsetX = 0;
    offsetY = 0;
    compositeParent = false;

    initialize(zIndex: number, textures: PIXI.Texture | Array<PIXI.Texture>) {
        if (!textures) {
            textures = [];
        } else if (!(textures instanceof Array) && (textures as PIXI.Texture).baseTexture) {
            textures = [textures as PIXI.Texture];
        }
        this.textures = textures as Array<PIXI.Texture>;
        this.z = this.zIndex = zIndex;
        // this.visible = false;
    }

    clear() {
        this.pointsBuf.length = 0;
        this.modificationMarker = 0;
        this.hasAnim = false;
    }

    addFrame(texture_: PIXI.Texture | String | number, x: number, y: number, animX: number, animY: number) {
        var texture: PIXI.Texture;
        var textureIndex = 0;

        if (typeof texture_ === "number") {
            textureIndex = texture_;
            texture = this.textures[textureIndex];
        } else {
            if (typeof texture_ === "string") {
                texture = PIXI.Texture.fromImage(texture_);
            } else {
                texture = texture_ as PIXI.Texture;
            }

            var found = false;
            var textureList = this.textures;
            for (var i = 0; i < textureList.length; i++) {
                if (textureList[i].baseTexture === texture.baseTexture) {
                    textureIndex = i;
                    found = true;
                    break;
                }
            }

            if (!found) {
                // textureIndex = this.textures.length;
                // this.textures.push(texture);
                return false;
            }
        }

        this.addRect(textureIndex, texture.frame.x, texture.frame.y, x, y, texture.frame.width, texture.frame.height, animX, animY);
        return true;
    }

    addRect(textureIndex: number, u: number, v: number, x: number, y: number, tileWidth: number, tileHeight: number, animX: number = 0, animY: number = 0) {
        var pb = this.pointsBuf;
        this.hasAnim = this.hasAnim || animX > 0 || animY > 0;
        if (tileWidth === tileHeight) {
            pb.push(u);
            pb.push(v);
            pb.push(x);
            pb.push(y);
            pb.push(tileWidth);
            pb.push(tileHeight);
            pb.push(animX | 0);
            pb.push(animY | 0);
            pb.push(textureIndex);
        } else {
            var i: number;
            if (tileWidth % tileHeight === 0) {
                //horizontal line on squares
                for (i = 0; i < tileWidth / tileHeight; i++) {
                    pb.push(u + i * tileHeight);
                    pb.push(v);
                    pb.push(x + i * tileHeight);
                    pb.push(y);
                    pb.push(tileHeight);
                    pb.push(tileHeight);
                    pb.push(animX | 0);
                    pb.push(animY | 0);
                    pb.push(textureIndex);
                }
            } else if (tileHeight % tileWidth === 0) {
                //vertical line on squares
                for (i = 0; i < tileHeight / tileWidth; i++) {
                    pb.push(u);
                    pb.push(v + i * tileWidth);
                    pb.push(x);
                    pb.push(y + i * tileWidth);
                    pb.push(tileWidth);
                    pb.push(tileWidth);
                    pb.push(animX | 0);
                    pb.push(animY | 0);
                    pb.push(textureIndex);
                }
            } else {
                //ok, ok, lets use rectangle
                pb.push(u);
                pb.push(v);
                pb.push(x);
                pb.push(y);
                pb.push(tileWidth);
                pb.push(tileHeight);
                pb.push(animX | 0);
                pb.push(animY | 0);
                pb.push(textureIndex);
            }
        }
    }

    renderCanvas(renderer: PIXI.CanvasRenderer) {
        if (!renderer || !renderer.plugins || !renderer.context) {
            return;
        }
        var plugin = renderer.plugins.tilemap;
        if (!plugin.dontUseTransform) {
            var wt = this.worldTransform;
            renderer.context.setTransform(
                wt.a,
                wt.b,
                wt.c,
                wt.d,
                wt.tx * renderer.resolution,
                wt.ty * renderer.resolution
            );
        }
        this.renderCanvasCore(renderer);
    }

    renderCanvasCore(renderer: PIXI.CanvasRenderer) {
        if (!renderer || !renderer.plugins || !renderer.context) {
            return;
        }
        if (this.textures.length === 0) return;
        var points = this.pointsBuf;
        renderer.context.fillStyle = '#000000';
        for (var i = 0, n = points.length; i < n; i += 9) {
            var x1 = points[i], y1 = points[i + 1];
            var x2 = points[i + 2], y2 = points[i + 3];
            var w = points[i + 4];
            var h = points[i + 5];
            x1 += points[i + 6] * renderer.plugins.tilemap.tileAnim[0];
            y1 += points[i + 7] * renderer.plugins.tilemap.tileAnim[1];
            var textureIndex = points[i + 8];
            if (textureIndex >= 0) {
                renderer.context.drawImage(this.textures[textureIndex].baseTexture.source as any, x1, y1, w, h, x2, y2, w, h);
            } else {
                renderer.context.globalAlpha = 0.5;
                renderer.context.fillRect(x2, y2, w, h);
                renderer.context.globalAlpha = 1;
            }
        }
    }

    vbId = 0;
    vbBuffer: ArrayBuffer|null = null;
    vbArray: Float32Array|null = null;
    vbInts: Uint32Array|null = null;

    renderWebGL(renderer: PIXI.WebGLRenderer) {
        var gl = renderer.gl;
        var plugin = renderer.plugins.simpleTilemap;
        var shader = plugin.getShader();
        renderer.setObjectRenderer(plugin);
        renderer.bindShader(shader);
        //TODO: dont create new array, please
        this._globalMat = this._globalMat || new PIXI.Matrix();
        renderer._activeRenderTarget.projectionMatrix.copy(this._globalMat).append(this.worldTransform);
        shader.uniforms.projectionMatrix = this._globalMat.toArray(true);
        shader.uniforms.shadowColor = this.shadowColor;
        var af = shader.uniforms.animationFrame = plugin.tileAnim;
        //shader.syncUniform(shader.uniforms.animationFrame);
        this.renderWebGLCore(renderer, plugin);
    }

    renderWebGLCore(renderer: PIXI.WebGLRenderer, plugin: PIXI.ObjectRenderer) {
        var points = this.pointsBuf;
        if (points.length === 0) return;
        var rectsCount = points.length / 9;
        var tile:any = plugin || renderer.plugins.simpleTilemap;
        var gl = renderer.gl;


        var shader = tile.getShader();
        var textures = this.textures;
        if (textures.length === 0) return;

        tile.bindTextures(renderer, shader, textures);

        //lost context! recover!
        var vb = tile.getVb(this.vbId);
        if (!vb) {
            vb = tile.createVb();
            this.vbId = vb.id;
            this.vbBuffer = null;
            this.modificationMarker = 0;
        }
        var vao = vb.vao;
        renderer.bindVao(vao);

        tile.checkIndexBuffer(rectsCount);

        var vertexBuf = vb.vb as PIXI.glCore.GLBuffer;
        //if layer was changed, re-upload vertices
        vertexBuf.bind();
        var vertices = rectsCount * shader.vertPerQuad;
        if (vertices === 0) return;
        if (this.modificationMarker !== vertices) {
            this.modificationMarker = vertices;
            var vs = shader.stride * vertices;
            if (!this.vbBuffer || this.vbBuffer.byteLength < vs) {
                //!@#$ happens, need resize
                var bk = shader.stride;
                while (bk < vs) {
                    bk *= 2;
                }
                this.vbBuffer = new ArrayBuffer(bk);
                this.vbArray = new Float32Array(this.vbBuffer);
                this.vbInts = new Uint32Array(this.vbBuffer);
                vertexBuf.upload(this.vbBuffer, 0, true);
            }

            var arr:any = this.vbArray, ints = this.vbInts;
            //upload vertices!
            var sz = 0;
            //var tint = 0xffffffff;
            var textureId: number = 0;
            var shiftU: number = this.offsetX;
            var shiftV: number = this.offsetY;

            //var tint = 0xffffffff;
            var tint = -1;
            for (var i = 0; i < points.length; i += 9) {
                var eps = 0.5;
                if (this.compositeParent){
                    textureId = (points[i + 8] >> 2);
                    shiftU = this.offsetX * (points[i + 8] & 1);
                    shiftV = this.offsetY * ((points[i + 8] >> 1) & 1);
                }
                var x = points[i + 2], y = points[i + 3];
                var w = points[i + 4], h = points[i + 5];
                var u = points[i] + shiftU, v = points[i + 1] + shiftV;
                var animX = points[i + 6], animY = points[i + 7];
                arr[sz++] = x;
                arr[sz++] = y;
                arr[sz++] = u;
                arr[sz++] = v;
                arr[sz++] = u + eps;
                arr[sz++] = v + eps;
                arr[sz++] = u + w - eps;
                arr[sz++] = v + h - eps;
                arr[sz++] = animX;
                arr[sz++] = animY;
                arr[sz++] = textureId;
                arr[sz++] = x + w;
                arr[sz++] = y;
                arr[sz++] = u + w;
                arr[sz++] = v;
                arr[sz++] = u + eps;
                arr[sz++] = v + eps;
                arr[sz++] = u + w - eps;
                arr[sz++] = v + h - eps;
                arr[sz++] = animX;
                arr[sz++] = animY;
                arr[sz++] = textureId;
                arr[sz++] = x + w;
                arr[sz++] = y + h;
                arr[sz++] = u + w;
                arr[sz++] = v + h;
                arr[sz++] = u + eps;
                arr[sz++] = v + eps;
                arr[sz++] = u + w - eps;
                arr[sz++] = v + h - eps;
                arr[sz++] = animX;
                arr[sz++] = animY;
                arr[sz++] = textureId;
                arr[sz++] = x;
                arr[sz++] = y + h;
                arr[sz++] = u;
                arr[sz++] = v + h;
                arr[sz++] = u + eps;
                arr[sz++] = v + eps;
                arr[sz++] = u + w - eps;
                arr[sz++] = v + h - eps;
                arr[sz++] = animX;
                arr[sz++] = animY;
                arr[sz++] = textureId;
            }

            // if (vs > this.vbArray.length/2 ) {
            vertexBuf.upload(arr, 0, true);
            // } else {
            //     var view = arr.subarray(0, vs);
            //     vb.upload(view, 0);
            // }
        }
        gl.drawElements(gl.TRIANGLES, rectsCount * 6, gl.UNSIGNED_SHORT, 0);
    }

    isModified(anim: boolean) {
        if (this.modificationMarker !== this.pointsBuf.length ||
            anim && this.hasAnim) {
            return true;
        }
        return false;
    }

    clearModify() {
        this.modificationMarker = this.pointsBuf.length;
    }
}

export class GraphicsLayer extends PIXI.Graphics {

    z: number;
    zIndex: number;

    constructor(zIndex: number) {
        super();
        this.z = this.zIndex = zIndex;
    }

    renderCanvas(renderer: any) {
        var wt: any = null;
        if (renderer.plugins.tilemap.dontUseTransform) {
            wt = this.transform.worldTransform;
            this.transform.worldTransform = PIXI.Matrix.IDENTITY;
        }
        renderer.plugins.graphics.render(this);
        if (renderer.plugins.tilemap.dontUseTransform) {
            this.transform.worldTransform = wt;
        }
        renderer.context.globalAlpha = 1.0;
    }

    renderWebGL(renderer: PIXI.WebGLRenderer) {
        if (!this._webGL[renderer.CONTEXT_UID])
            this.dirty++;
        super.renderWebGL(renderer)
    }

    isModified(anim: boolean): boolean {
        return false;
    }

    clearModify() {
    }
}

export const Constant = {
    maxTextures: 4,
    bufferSize: 2048,
    boundSize: 1024,
    boundCountPerBuffer: 4,
}


export class CompositeRectTileLayer extends PIXI.Container {

    constructor(zIndex?: number, bitmaps?: Array<PIXI.Texture>, texPerChild?: number) {
        super();
        this.initialize.apply(this, arguments as any);
    }

    updateTransform() {
        super.displayObjectUpdateTransform()
    }

    z: number|undefined = undefined;
    zIndex: number|undefined = undefined;
    modificationMarker = 0;
    shadowColor = new Float32Array([0.0, 0.0, 0.0, 0.5]);
    _globalMat: PIXI.Matrix|null = null;

    texPerChild: number|undefined = undefined;

    initialize(zIndex?: number, bitmaps?: Array<PIXI.Texture>, texPerChild?: number) {
        if (texPerChild as any === true) {
            //old format, ignore it!
            texPerChild = 0;
        }
        this.z = this.zIndex = zIndex;
        this.texPerChild = texPerChild || Constant.boundCountPerBuffer * Constant.maxTextures;
        if (bitmaps) {
            this.setBitmaps(bitmaps);
        }
    }

    setBitmaps(bitmaps: Array<PIXI.Texture>) {
        var texPerChild:any = this.texPerChild;
        var len1 = this.children.length;
        var len2 = Math.ceil(bitmaps.length / texPerChild);
        var i: number;
        for (i = 0; i < len1; i++) {
            (this.children[i] as RectTileLayer).textures = bitmaps.slice(i * texPerChild, (i + 1) * texPerChild);
        }
        for (i = len1; i < len2; i++) {
            var layer = new RectTileLayer(this.zIndex as any, bitmaps.slice(i * texPerChild, (i + 1) * texPerChild));
            layer.compositeParent = true;
            layer.offsetX = Constant.boundSize;
            layer.offsetY = Constant.boundSize;
            this.addChild(layer);
        }
    }

    clear() {
        for (var i = 0; i < this.children.length; i++) {
            (this.children[i] as RectTileLayer).clear();
        }
        this.modificationMarker = 0;
    }

    addRect(textureIndex: number, u: number, v: number, x: number, y: number, tileWidth: number, tileHeight: number) {
        const childIndex: number = textureIndex / (this.texPerChild as any) >> 0;
        const textureId: number = textureIndex % (this.texPerChild as any);

        if (this.children[childIndex] && (this.children[childIndex] as RectTileLayer).textures) {
            (this.children[childIndex] as RectTileLayer).addRect(textureId, u, v, x, y, tileWidth, tileHeight);
        }
    }

    addFrame(texture_: PIXI.Texture | String | number, x: number, y: number, animX?: number, animY?: number) {
        var texture: PIXI.Texture;
        var layer: any = null;
        var ind: number = 0;
        var children = this.children;

        if (typeof texture_ === "number") {
            var childIndex = texture_ / (this.texPerChild as any) >> 0;
            layer = children[childIndex] as RectTileLayer;

            if (!layer) {
                layer = children[0] as RectTileLayer;
                if (!layer) {
                    return false;
                }
                ind = 0;
            } else {
                ind = texture_ % (this.texPerChild as any);
            }

            texture = layer.textures[ind];
        } else {
            if (typeof texture_ === "string") {
                texture = PIXI.Texture.fromImage(texture_);
            } else {
                texture = texture_ as PIXI.Texture;
            }

            for (var i = 0; i < children.length; i++) {
                var child = children[i] as RectTileLayer;
                var tex = child.textures;
                for (var j = 0; j < tex.length; j++) {
                    if (tex[j].baseTexture === texture.baseTexture) {
                        layer = child;
                        ind = j;
                        break;
                    }
                }
                if (layer) {
                    break;
                }
            }

            if (!layer) {
                for (i = 0; i < children.length; i++) {
                    var child = children[i] as RectTileLayer;
                    if (child.textures.length < (this.texPerChild as any)) {
                        layer = child;
                        ind = child.textures.length;
                        child.textures.push(texture);
                        break;
                    }
                }
                if (!layer) {
                    layer = new RectTileLayer(this.zIndex as any, texture);
                    layer.compositeParent = true;
                    layer.offsetX = Constant.boundSize;
                    layer.offsetY = Constant.boundSize;
                    children.push(layer);
                    ind = 0;
                }
            }
        }

        layer.addRect(ind, texture.frame.x, texture.frame.y, x, y, texture.frame.width, texture.frame.height, animX, animY);
        return true;
    }

    renderCanvas(renderer: any) {
        if (!this.visible || this.worldAlpha <= 0 || !this.renderable) {
            return;
        }
        var plugin = renderer.plugins.tilemap;
        if (!plugin.dontUseTransform) {
            var wt = this.worldTransform;
            renderer.context.setTransform(
                wt.a,
                wt.b,
                wt.c,
                wt.d,
                wt.tx * renderer.resolution,
                wt.ty * renderer.resolution
            );
        }
        var layers = this.children;
        for (var i = 0; i < layers.length; i++) {
            (layers[i] as RectTileLayer).renderCanvasCore(renderer);
        }
    }

    renderWebGL(renderer: PIXI.WebGLRenderer) {
        if (!this.visible || this.worldAlpha <= 0) {
            return;
        }
        var gl = renderer.gl;
        var plugin = renderer.plugins.tilemap;
        renderer.setObjectRenderer(plugin);
        var shader = plugin.getShader();
        renderer.bindShader(shader);
        //TODO: dont create new array, please
        this._globalMat = this._globalMat || new PIXI.Matrix();
        renderer._activeRenderTarget.projectionMatrix.copy(this._globalMat).append(this.worldTransform);
        shader.uniforms.projectionMatrix = this._globalMat.toArray(true);
        shader.uniforms.shadowColor = this.shadowColor;
        var af = shader.uniforms.animationFrame = plugin.tileAnim;
        //shader.syncUniform(shader.uniforms.animationFrame);
        var layers = this.children;
        for (var i = 0; i < layers.length; i++) {
            (layers[i] as RectTileLayer).renderWebGLCore(renderer, plugin);
        }
    }

    isModified(anim: boolean) {
        var layers = this.children;
        if (this.modificationMarker !== layers.length) {
            return true;
        }
        for (var i = 0; i < layers.length; i++) {
            if ((layers[i] as RectTileLayer).isModified(anim)) {
                return true;
            }
        }
        return false;
    }

    clearModify() {
        var layers = this.children;
        this.modificationMarker = layers.length;
        for (var i = 0; i < layers.length; i++) {
            (layers[i] as RectTileLayer).clearModify();
        }
    }
}

export class CanvasTileRenderer {

    renderer: PIXI.CanvasRenderer;
    tileAnim = [0, 0];
    dontUseTransform = false;

    constructor(renderer: PIXI.CanvasRenderer) {
        this.renderer = renderer;
        this.tileAnim = [0, 0];
    }
}

PIXI.CanvasRenderer.registerPlugin('tilemap', CanvasTileRenderer);

