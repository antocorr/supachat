import type { PromptTemplates } from './PromptTemplates';
import type { Actor } from './Actor';
import type { Conversation } from './Conversation';

export class PromptBuilder {
    templates: typeof PromptTemplates;

    constructor(templates: typeof PromptTemplates) {
        if (!Object.prototype.hasOwnProperty.call(templates, 'promptStack')) {
            console.warn(`[PromptBuilder] ${templates.name} does not declare a static promptStack — falling back to inherited stack. New methods won't be called.`);
        }
        this.templates = templates;
    }

    createPrompt(actor: Actor, conversation: Conversation): string {
        const fragments: string[] = [];
        for (const method of this.templates.promptStack) {
            const fragment = (this.templates as any)[method]?.(actor, conversation) ?? null;
            if (fragment !== null) fragments.push(fragment);
        }
        return fragments.join('\n');
    }
}
