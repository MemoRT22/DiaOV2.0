export type Term = { one: string; many: string };

export type VocabularyKey = 'activity' | 'division' | 'rank' | 'passport' | 'route' | 'stamp' | 'interests';

export type ColorKey =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral'
  | 'background'
  | 'surface'
  | 'surfaceRaised'
  | 'ink'
  | 'inkMuted'
  | 'line';

export type AssetKey = 'logoMark' | 'logoWordmark' | 'logoSeal' | 'logoTagline' | 'mascot';

export type TextKey =
  | 'navPassport'
  | 'navActivities'
  | 'navInterests'
  | 'loginTitle'
  | 'loginSubtitle'
  | 'loginHelp'
  | 'welcomeTitle'
  | 'welcomeBody'
  | 'passportIntro'
  | 'progressNext'
  | 'progressMax'
  | 'activitiesIntro'
  | 'activitiesEmpty'
  | 'interestsPromptTitle'
  | 'interestsPromptBody'
  | 'interestsTitle'
  | 'interestsBody'
  | 'interestsSaved'
  | 'interestsClosed'
  | 'closingTitle'
  | 'closingBody';

export type RankText = { name: string; description: string; promotion: string };

export type ThemeConfig = {
  meta: {
    eventName: string;
    editionLabel: string;
    tagline: string;
    taglineHighlight: string;
    organizer: string;
    guideName: string;
  };
  colors: Record<ColorKey, string>;
  typography: { display: string; body: string };
  radius: number;
  style: { background: 'starfield' | 'plain'; glowRing: boolean; metallicTitles: boolean };
  assets: Record<AssetKey, string>;
  vocabulary: Record<VocabularyKey, Term>;
  ranks: RankText[];
  texts: Record<TextKey, string>;
  divisions: Record<string, { color: string }>;
};

export const VOCABULARY_KEYS: VocabularyKey[] = ['activity', 'division', 'rank', 'passport', 'route', 'stamp', 'interests'];
export const TEXT_KEYS: TextKey[] = [
  'navPassport',
  'navActivities',
  'navInterests',
  'loginTitle',
  'loginSubtitle',
  'loginHelp',
  'welcomeTitle',
  'welcomeBody',
  'passportIntro',
  'progressNext',
  'progressMax',
  'activitiesIntro',
  'activitiesEmpty',
  'interestsPromptTitle',
  'interestsPromptBody',
  'interestsTitle',
  'interestsBody',
  'interestsSaved',
  'interestsClosed',
  'closingTitle',
  'closingBody',
];
export const ASSET_KEYS: AssetKey[] = ['logoMark', 'logoWordmark', 'logoSeal', 'logoTagline', 'mascot'];
export const COLOR_KEYS: ColorKey[] = [
  'primary',
  'secondary',
  'accent',
  'success',
  'warning',
  'error',
  'neutral',
  'background',
  'surface',
  'surfaceRaised',
  'ink',
  'inkMuted',
  'line',
];
