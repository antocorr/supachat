export interface Actor {
    id?: string;
    name: string;
    introduction: string;
    appearance?: string | null;
    voice?: string;
    language?: string;
    is_narrator?: boolean;
    response_length?: string;
    kokoro_voice?: string;
    /** Used by example PromptTemplates methods like getActionNarration */
    actorRole?: string;
    data?: {
        personality?: string;
    };
    [key: string]: any;
}
