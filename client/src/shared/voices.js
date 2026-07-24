/**
 * Shared TTS voice data for Piper TTS engine.
 * Used by AgentPanel and ConversationList.
 *
 * @type {Record<string, Array<{name: string, quality: string}>>}
 */
export const voicesByLanguage = {
  en_GB: [
    { name: 'alan', quality: 'medium' },
    { name: 'alba', quality: 'medium' },
    { name: 'cori', quality: 'high' },
    { name: 'jenny_dioco', quality: 'medium' },
    { name: 'northern_english_male', quality: 'medium' },
    { name: 'semaine', quality: 'medium' },
    { name: 'southern_english_female', quality: 'low' },
    { name: 'vctk', quality: 'medium' }
  ],
  en_US: [
    { name: 'amy', quality: 'medium' },
    { name: 'arctic', quality: 'medium' },
    { name: 'bryce', quality: 'medium' },
    { name: 'hfc_female', quality: 'medium' },
    { name: 'hfc_male', quality: 'medium' },
    { name: 'joe', quality: 'medium' },
    { name: 'john', quality: 'medium' },
    { name: 'kristin', quality: 'medium' },
    { name: 'kusal', quality: 'medium' },
    { name: 'l2arctic', quality: 'medium' },
    { name: 'lessac', quality: 'high' },
    { name: 'libritts', quality: 'high' },
    { name: 'libritts_r', quality: 'medium' },
    { name: 'ljspeech', quality: 'high' },
    { name: 'norman', quality: 'medium' },
    { name: 'ryan', quality: 'high' }
  ],
  it_IT: [
    { name: 'paola', quality: 'medium' },
    { name: 'riccardo', quality: 'x_low' }
  ],
  es_ES: [
    { name: 'carlfm', quality: 'x_low' },
    { name: 'davefx', quality: 'medium' },
    { name: 'mls_10246', quality: 'low' },
    { name: 'mls_9972', quality: 'low' },
    { name: 'sharvard', quality: 'medium' }
  ],
  es_MX: [
    { name: 'ald', quality: 'medium' },
    { name: 'claude', quality: 'high' }
  ]
};

/** @type {string[]} */
export const languageOptions = Object.keys(voicesByLanguage);
