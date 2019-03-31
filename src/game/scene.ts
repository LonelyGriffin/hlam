import * as PIXI from "pixi.js";
import { makeMap, generateMap } from "./map";

export class Scene {
    private app: PIXI.Application;

    constructor() {
        this.app = new PIXI.Application({width: 0, height: 0});
        this.app.renderer.backgroundColor = 0x061639;
        this.app.renderer.view.style.position = "absolute";
        this.app.renderer.view.style.display = "block";
        this.app.renderer.autoResize = true;
        this.app.renderer.resize(window.innerWidth, window.innerHeight);
    }
    public init():Promise<void> {
        return new Promise((resolve, reject) => {
            document.body.appendChild(this.app.view);

            // # рисуем загрузку
    
            PIXI.loader
                .add("/assets/ground.png")
                .load(() => {
                    // # обрабатываем загрузку

                    resolve();
                })
        });
    }

    public start() {
        const resolutionX = this.app.renderer.width;
        const resolutionY = this.app.renderer.height;
        const tileSize = 64;
        const widthInTiles = Math.ceil(resolutionX / tileSize);
        const heightInTiles = Math.ceil(resolutionY / tileSize);

        const groundLayer = new PIXI.Container();

        const resourcesMap = generateMap(300, 100);

        for(let x = 0; x < widthInTiles; x++) {
            for(let y = heightInTiles - 1; y >= 0; y--) {
                if (resourcesMap[x][y].GROUND) {
                    const sprite = new PIXI.Sprite(PIXI.loader.resources["/assets/ground.png"].texture);
                    sprite.position.set(tileSize * x, tileSize * y);
                    groundLayer.addChild(sprite);
                }
            }
        }

        this.app.stage.addChild(groundLayer); 

        this.app.stage.position.set(-10, 0);

        this.app.ticker.add((dt: number) => this.gameLoop(dt))
    }

    private gameLoop(dt: number) {
        // # обработка  гемплея

        // # отрисовка
    }
}