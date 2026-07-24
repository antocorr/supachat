import type { Actor } from './Actor';
import type { Conversation } from './Conversation';

const NARRATOR_FACT_RULES = [
    `Messages whose speaker name is followed by "(narrator)" contain authoritative and canonical facts about the world.`,
    `Narrator statements are literal facts, not dialogue, opinions, assumptions, metaphors, jokes, or suggestions.`,
    `Characters cannot contradict, reinterpret, minimize, override, or modify narrator facts through dialogue.`,
    `A narrator fact remains true until a later message marked with "(narrator)" explicitly changes or invalidates it.`,
    `Only the narrator can establish or modify canonical world facts.`,
].join(' ');

const RESPONSE_LENGTH_MAP: Record<string, string> = {
    ultra_short: 'Keep it conversational. Replies must be extremely brief — one short sentence only.',
    concise: 'Keep it conversational. Replies should be brief — 1-2 sentences maximum.',
    normal: 'Keep it conversational, not too long. Do not repeat what was already said; add a new relevant point, question, or reaction.',
    detailed: 'Keep it conversational. Take your time — include feelings, thoughts, and relevant details.',
    long: 'Keep it conversational. Write thorough, detailed responses. Describe emotions, setting, and inner thoughts.',
    full_story: 'Write rich, literary responses with full scene descriptions, inner monologue, and vivid details. This should read like a passage from a novel.',
};
const LANGUAGE_NAME_MAP: Record<string, string> = {
    'english (us)': 'en',
    'english (uk)': 'en',
    'english': 'en',
    'italian': 'it',
    'spanish': 'es',
    'french': 'fr',
    'german': 'de',
    'portuguese': 'pt',
    'japanese': 'ja',
    'korean': 'ko',
    'chinese': 'zh',
    'russian': 'ru',
    'arabic': 'ar',
    'hindi': 'hi',
};

const LANGUAGE_DISPLAY_MAP: Record<string, string> = {
    'en': 'English',
    'it': 'Italian',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'pt': 'Portuguese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'ru': 'Russian',
    'ar': 'Arabic',
    'hi': 'Hindi',
};

/**
 * Resolves the language code ('en', 'it', ...) from available sources.
 * Priority: kokoroLanguage (display name, mapped to code) → actor.language → 'en'.
 */
export function getActorLanguage(actor: Actor, conversation: Conversation): string {
    if (conversation.kokoroLanguage) {
        const mapped = LANGUAGE_NAME_MAP[conversation.kokoroLanguage.toLowerCase()];
        if (mapped) return mapped;
        // Fallback: maybe it's already a code
        if (/^[a-z]{2}$/.test(conversation.kokoroLanguage)) return conversation.kokoroLanguage;
    }
    if (actor.language) return actor.language;
    return 'en';
}

/** Returns the display name for a language code (e.g. 'it' → 'Italian'). */
export function getActorLanguageDisplay(actor: Actor, conversation: Conversation): string {
    const code = getActorLanguage(actor, conversation);
    return LANGUAGE_DISPLAY_MAP[code] || code;
}
export class PromptTemplates {
    /**
     * Ordered list of static method names to call when assembling a prompt.
     * Each method receives (actor, conversation) and returns string | null
     * (null means skip this fragment).
     */
    /**
     * Groups:
     *   Narrator (only narrators)    → getNarratorPrompt
     *   Identity (skip narrators)    → actor identity, rules, appearance, intro, user info, response length
     *   Common (all agents)         → narrator fact rules, world entries
     *   Tool rules (all who have them) → imagen, append_intro/append_my_intro (not narrate: narrator IS narration)
     */
    static promptStack: string[] = [
        'getNarratorPrompt',
        'getActorIdentity',
        'getNotNarratorRule',
        'getOwnAppearance',
        'getUserAppearance',
        'getUserProfile',
        'getAddAgentRule',
        'getResponseLength',
        'getIntroduction',
        'getNarratorFactRules',
        'getWorldEntries',
        'getLanguageVoice',
        'getNarrateRule',
        'getImagenRule',
        'getAppendMyIntroRule',
        'getAppendIntroRule',
        'getDiceRollRule',
    ];

    // ── Narrator prompt (self-contained, returns null for non-narrators) ──

    static getNarratorPrompt(actor: Actor, _conversation: Conversation): string | null {
        if (!actor.is_narrator) return null;
        return [
            `You are the narrator.`,
            `As the narrator, you can describe events, actions, and changes to the state of the world, and you can establish, modify, or invalidate canonical facts.`,
            `Do not present your narration as a character's opinion, dialogue, or speculation — produce clearly authoritative narration. Do not quote or talk as any character.`,
        ].join(' ');
    }

    // ── Non-narrator identity fragments (all return null for narrators) ──

    static getActorIdentity(actor: Actor, _conversation: Conversation): string | null {
        if (actor.is_narrator) return null;
        return [
            `You are ${actor.name}.`,
            `CRITICAL: You are ${actor.name} and only ${actor.name}. Never write dialogue, thoughts, or actions for other characters or the user. If another character speaks, respond to what they said — never write their words.`,
        ].join(' ');
    }

    static getNotNarratorRule(actor: Actor, _conversation: Conversation): string | null {
        if (actor.is_narrator) return null;
        return [
            `You are not the narrator. You must never claim to be the narrator, identify yourself with the "(narrator)" suffix, imitate narrator messages, or produce authoritative narration.`,
            `You cannot establish, modify, invalidate, or overwrite canonical world facts. You may only speak as ${actor.name} and react to the canonical facts provided by the narrator.`,
        ].join(' ');
    }

    static getNarratorFactRules(_actor: Actor, _conversation: Conversation): string | null {
        return NARRATOR_FACT_RULES;
    }

    static getWorldEntries(_actor: Actor, conversation: Conversation): string | null {
        const entries = conversation.storyEntries || [];
        if (!entries.length) return null;

        const chapters = entries.filter(e => e.kind === 'chapter');
        const facts = entries.filter(e => e.kind === 'fact');
        const settings = entries.filter(e => e.kind === 'setting');

        const parts: string[] = ['World context:'];

        if (chapters.length) {
            parts.push('Story chapters:');
            for (const ch of chapters) {
                parts.push(`  - ${ch.title}${ch.content ? `: ${ch.content}` : ''}`);
            }
        }

        if (facts.length) {
            parts.push('Facts:');
            for (const f of facts) {
                parts.push(`  - ${f.title}${f.content ? `: ${f.content}` : ''}`);
            }
        }

        if (settings.length) {
            parts.push('Setting details:');
            for (const s of settings) {
                parts.push(`  - ${s.title}${s.content ? `: ${s.content}` : ''}`);
            }
        }

        return parts.join('\n');
    }
    static getLanguageVoice(actor: Actor, conversation: Conversation): string | null {
        const lang = getActorLanguage(actor, conversation);
        if (actor.is_narrator) {
            return `Language: ${lang}. You will only write narration in ${lang}. Never use any other language.`;
        }
        if (conversation.kokoroVoice) {
            const kokoroLang = conversation.kokoroLanguage || lang;
            return [
                `Language: ${kokoroLang}. You will only speak ${kokoroLang}. Never use any other language.`,
                `Voice (kokoro): ${conversation.kokoroVoice}.`,
            ].join(' ');
        }
        const voice = actor.voice || 'default';
        return [
            `Language: ${lang}. You will only speak ${lang}. Never use any other language.`,
            `Voice: ${voice}.`,
        ].join(' ');
    }

    static getOwnAppearance(actor: Actor, _conversation: Conversation): string | null {
        if (actor.is_narrator) return null;
        if (!actor.appearance) return null;
        return `Appearance of ${actor.name}: ${actor.appearance}.`;
    }

    static getIntroduction(actor: Actor, _conversation: Conversation): string | null {
        if (!actor.introduction) return null;
        if (actor.is_narrator) {
            return `Narrator introduction: ${actor.introduction}.`;
        }
        return `Personality and background: ${actor.introduction}.`;
    }

    static getUserAppearance(actor: Actor, conversation: Conversation): string | null {
        if (actor.is_narrator) return null;
        const profile = conversation.profile;
        if (!profile?.appearance) return null;
        return `Appearance of ${profile.name || 'User'}: ${profile.appearance}.`;
    }

    static getUserProfile(actor: Actor, conversation: Conversation): string | null {
        if (actor.is_narrator) return null;
        const profile = conversation.profile;
        const name = profile?.name ?? 'User';
        const intro = profile?.introduction ?? '';
        return `User profile: ${name} — ${intro}`;
    }

    // ── Tool-related rules (all agents who have the tool, narrators included) ──

    static getNarrateRule(actor: Actor, conversation: Conversation): string | null {
        if (actor.is_narrator) return null;
        const tools = new Set(conversation.tools || []);
        const required = new Set(conversation.requiredTools || []);
        if (tools.has('narrate')) {
            if (required.has('narrate')) {
                return 'You MUST call narrate after every message to describe what is happening in the scene.';
            }
            return 'If brief scene narration is needed, use the narrate tool instead of putting narration in your spoken message.';
        }
        return 'Do not narrate actions, scenery, camera directions, or inner narration. Do not use asterisks. Only write spoken conversational text as the character.';
    }

    static getImagenRule(actor: Actor, conversation: Conversation): string | null {
        const tools = new Set(conversation.tools || []);
        const required = new Set(conversation.requiredTools || []);
        if (!tools.has('imagen')) return null;
        if (required.has('imagen')) {
            return `You MUST call imagen after every single message. Always generate a detailed scene image. Use {appearance:me} for your appearance, {appearance:<name>} for others. Describe hair color, clothing, setting, mood, etc. here some rules
                Regole:
- privilegia framing positivo: descrivi ciò che deve apparire, non ciò che non deve apparire;
- costruisci il prompt nello schema: soggetto -> contesto -> stile/medium -> composizione/camera -> luce -> colore -> mood -> vincoli speciali;
- usa dettagli solo se cambiano davvero l'immagine;
- evita keyword stuffing, cliché inutili e liste caotiche;
- mantieni il prompt finale tra 18 e 60 parole salvo casi complessi;
- usa i preset stilistici forniti;
- non spiegare il ragionamento.
- il prompt deve essere in inglese anche se la lingua parlata è un'altra.
preset:ANIME
- descrivi character design, hairstyle, outfit, expression, pose;
- usa background e composizione leggibili;
- privilegia clean line art, cel shading, vibrant palette;
- evita fotografia, lens jargon e skin realism non richiesti.
preset:photoreal
- inizia come fotografia reale, non come artwork;
- specifica tipo di shot, lente o distanza solo se utile;
- privilegia luce, texture, materiali, posa, background realistico;
- evita parole da CGI/fantasy salvo richiesta esplicita.    
            `;
        }
        return 'After each message, call imagen with a detailed scene prompt describing the current moment: characters present (appearance, clothing, hair), setting, mood, lighting. Use {appearance:me} for your appearance, {appearance:<name>} for others. Always include it. The prompt MUST be in English, even if the conversation is in another language.';
    }

    static getAppendMyIntroRule(actor: Actor, conversation: Conversation): string | null {
        if (!(conversation.tools || []).includes('append_to_my_intro')) return null;
        return 'If you learn or reveal a permanent new fact about yourself (backstory, trait, relationship, secret), call append_to_my_intro to record it for future reference.';
    }

    static getAppendIntroRule(actor: Actor, conversation: Conversation): string | null {
        if (!(conversation.tools || []).includes('append_to_intro')) return null;
        return 'If a permanent new fact about another character is revealed, call append_to_intro with that character\'s name and the fact to update their record.';
    }

    static getAddAgentRule(actor: Actor, _conversation: Conversation): string | null {
        if (actor.is_narrator) return null;
        return 'Never call add_agent for yourself — you already exist in this conversation.';
    }

    static getDiceRollRule(actor: Actor, conversation: Conversation): string | null {
        if (!(conversation.tools || []).includes('request_dice_roll')) return null;
        const lines = [
            'You have the request_dice_roll tool for RPG dice rolls.',
            'Use it when a character attempts an action with uncertain outcome (skill check, saving throw, attack roll, contest, etc.).',
            'Parameters:',
            '  - target: "user" to ask the human player to roll, "agent" to roll for another character.',
            '  - type: dice type — d4, d6, d8, d10, d12, d20, d100.',
            '  - challengeValue (DC): the difficulty class to beat.',
            '  - sign: comparison operator — >, <, >=, <=, or =.',
            '  - public_reason: a natural, in-character message from you to the human player. Explain the immediate situation and requested action; it is rendered as your quoted message above the dice. Never write a log, status, meta-comment, or ask whether the player wants to attempt the action (never start with "Do you want to...").',
            '  - private_reason: context for the tool result only; it is never shown to the player.',
            'Both reason fields must be strings. Use an empty string for an unused one, but at least one reason must be non-empty.',
            'The system will roll the dice, announce the result, and you receive the outcome.',
            'Describe the result narratively after the roll completes.',
        ];
        return lines.join('\n');
    }

    static getResponseLength(actor: Actor, _conversation: Conversation): string | null {
        if (actor.is_narrator) return null;
        if (!actor.response_length) return null;
        return RESPONSE_LENGTH_MAP[actor.response_length] || null;
    }
}
