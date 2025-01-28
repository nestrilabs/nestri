interface BaseInput {
    timestamp?: number; // Add a timestamp for better context (optional)
}

interface MouseMove extends BaseInput {
    type: "MouseMove";
    x: number;
    y: number;
}

interface MouseMoveAbs extends BaseInput {
    type: "MouseMoveAbs";
    x: number;
    y: number;
}

interface MouseWheel extends BaseInput {
    type: "MouseWheel";
    x: number;
    y: number;
}

interface MouseKeyDown extends BaseInput {
    type: "MouseKeyDown";
    key: number;
}

interface MouseKeyUp extends BaseInput {
    type: "MouseKeyUp";
    key: number;
}

interface KeyDown extends BaseInput {
    type: "KeyDown";
    key: number;
}

interface KeyUp extends BaseInput {
    type: "KeyUp";
    key: number;
}


export type Input =
    | MouseMove
    | MouseMoveAbs
    | MouseWheel
    | MouseKeyDown
    | MouseKeyUp
    | KeyDown
    | KeyUp;

