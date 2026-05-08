export type OffsetRange = {
    start: number;
    end: number;
};

export type ImportNode = {
    name?: string;
    path?: string;
    range: OffsetRange;
    nameRange?: OffsetRange;
    pathRange?: OffsetRange;
};

export type BlockNode = {
    tag: 'python' | 'template' | 'style';
    range: OffsetRange;
    contentRange: OffsetRange;
    content: string;
};

export type PythonSymbol = {
    name: string;
    range: OffsetRange;
};

export type DataField = {
    name: string;
    type: string;
    range: OffsetRange;
    nameRange: OffsetRange;
};

export type ComponentUse = {
    name: string;
    range: OffsetRange;
};

export type DirectiveUse = {
    name: string;
    value?: string;
    range: OffsetRange;
    valueRange?: OffsetRange;
};

export type EventUse = {
    name: string;
    handler: string;
    range: OffsetRange;
    handlerRange: OffsetRange;
};

export type InterpolationUse = {
    expression: string;
    range: OffsetRange;
    expressionRange: OffsetRange;
};

export type ClassUse = {
    name: string;
    range: OffsetRange;
};

export type LspaAst = {
    imports: ImportNode[];
    pythonBlock?: BlockNode;
    templateBlock?: BlockNode;
    styleBlock?: BlockNode;
    methods: PythonSymbol[];
    state: DataField[];
    props: DataField[];
    pyData: DataField[];
    components: ComponentUse[];
    directives: DirectiveUse[];
    events: EventUse[];
    interpolations: InterpolationUse[];
    cssClasses: ClassUse[];
    templateClasses: ClassUse[];
};
