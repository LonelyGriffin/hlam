import { IBlock, blockClone } from "./block";

export type IMap = IBlock[][];

export const makeMap = (width: number, height: number, block?: IBlock): IMap => {
    const result: IMap = Array(height);
    const defaultBlock: IBlock = block || { length: 0 };

    for(let x = 0; x < width; x++) {
        for(let y = 0; y < height; y++) {
            if (!result[x]) {
                result[x] = Array(width);
            }
            result[x][y] = blockClone(defaultBlock);
        }
    }

    return result;
}

export const generateMap = (width: number, height: number): IMap => {
    console.log("Синтезируем пространство");
    const map = makeMap(width, height);

    const waterLevel = Math.round(height * 0.8);
    const lavaLevel = Math.round(height * 0.1);

    console.log("Насыпаем земли");

    const groundFunction = Array(width).fill(waterLevel);

    for(let x = 0; x < width; x++) {
        const columnLevel = groundFunction[x];
        for(let y = 0; y < columnLevel; y++) {
            map[x][y].GROUND = {
                count: 100,
                microbes: 0,
                temperature: 0,
            }
        }
    }

    return map;
};
