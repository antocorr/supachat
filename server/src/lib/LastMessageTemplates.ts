import type { Actor } from './Actor';
import type { Conversation } from './Conversation';
import { getActorLanguage, getActorLanguageDisplay } from './PromptTemplates';
export class LastMessageTemplates {
    /**
     * Ordered list of static method names to call when assembling the last
     * user message before generation. Each method receives (actor, conversation)
     * and returns string | null (null means skip this fragment).
     */
    static lastMessageStack: string[] = [
        'getSpeakingInstruction',
        'getConversationAdvance',
        'getContinue',
    ];

    /**
     * Reminds the model who it is speaking as in the upcoming turn.
     * This lives in the last user message (not the system prompt) so it's
     * the closest instruction before generation.
     */
    static getSpeakingInstruction(actor: Actor, conversation: Conversation): string | null {
        if (actor.is_narrator) return null;
        const lang = getActorLanguage(actor, conversation);
        const randomSeed = Math.floor(Math.random() * 1000000);
        return `In the next message you will speak as ${actor.name}. Respond only as ${actor.name}. Write in ${lang}. mId: ${randomSeed}`;
    }

    /**
     * Warns the model not to repeat or rephrase the last message, and to
     * move the conversation forward instead of lingering on the same topic.
     */
    static getConversationAdvance(actor: Actor, _conversation: Conversation): string | null {
        if (actor.is_narrator) return null;
        return [
            `Do not repeat, rephrase, or echo the previous message. Do not ask the same question again or re-prompt the user for the same input.`,
            `Advance the conversation — respond to what was said and introduce a new point, question, action, or direction.`,
        ].join(' ');
    }

    /**
     * Generic continuation prompt used as a fallback for narrators.
     * Non-narrators already have getSpeakingInstruction + getConversationAdvance.
     * Ensures the last message is never empty (Ollama requires a user message).
     */
    static getContinue(actor: Actor, conversation: Conversation): string | null {
        if (!actor.is_narrator) return null;
        const lang = getActorLanguageDisplay(actor, conversation);
        const randomSeed = Math.floor(Math.random() * 1000000);
        return `Continue with the narration. Describe the next events and advance the scene. Write narration in ${lang}. only the tools (imagen etc) must be in english. mId: ${randomSeed}`;
    }
}