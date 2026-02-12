"strict"

import { CTPProcess } from "./process";
import { CTPTask } from "./task";

export interface ICandidate
{
    task: CTPTask;
    score: number;
    predTask : CTPTask | null;
    process: CTPProcess | null;
    processed: boolean;
}

export class CTPCandidate
{
    public task: CTPTask;
    public score: number;
    public predTask : CTPTask | null;
    public process: CTPProcess | null;
    public processed: boolean;

    constructor(t: CTPTask, predTask?: CTPTask, process?: CTPProcess)
    {
        this.task = t;
        this.process = process ?? null;
        this.predTask = predTask ?? null;
        this.score = Number.MIN_VALUE;
        this.processed = false;
    }
}