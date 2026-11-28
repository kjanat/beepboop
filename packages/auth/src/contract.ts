export const tokenPurposes = ['publish-actions', ''] as const;
export type TokenPurpose = (typeof tokenPurposes)[number];
