export interface Conversation {
    profile?: {
        name?: string;
        introduction?: string;
        appearance?: string | null;
        [key: string]: any;
    } | null;
    tools?: string[];
    requiredTools?: string[];
    kokoroVoice?: string;
    kokoroLanguage?: string;
    storyEntries?: Array<{id: string; kind: string; title: string; content: string;}>;
    [key: string]: any;
}
