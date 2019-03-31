import {ResourceType} from "./resource_type";

export type BlockResource = {
    count: number;
    temperature: number;
    microbes: number;
};

export type IBlock = {
    [key in ResourceType]?: BlockResource;
} & {length: number;};

export const blockClone = (block: IBlock):IBlock => {
    const result:IBlock = {
        length: 0,
    };
    Object.keys(block).forEach(key => { 
        if(key !== "length") {
            (result as any)[key] = {...(block as any)[key]};
            result.length++; 
        }
    });

    return result;
} 

