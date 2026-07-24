import type { LastMessageTemplates } from './LastMessageTemplates';
import type { Actor } from './Actor';
import type { Conversation } from './Conversation';

export class LastMessageBuilder {
    templates: typeof LastMessageTemplates;

    constructor(templates: typeof LastMessageTemplates) {
        if (!Object.prototype.hasOwnProperty.call(templates, 'lastMessageStack')) {
            console.warn(`[LastMessageBuilder] ${templates.name} does not declare a static lastMessageStack — falling back to inherited stack. New methods won't be called.`);
        }
        this.templates = templates;
    }

    buildMessage(actor: Actor, conversation: Conversation): string {
        const fragments: string[] = [];
        for (const method of this.templates.lastMessageStack) {
            const fragment = (this.templates as any)[method]?.(actor, conversation) ?? null;
            if (fragment !== null) fragments.push(fragment);
        }
        return fragments.join('\n');
    }
}
