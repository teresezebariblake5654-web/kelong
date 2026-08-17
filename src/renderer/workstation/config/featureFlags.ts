export type FeatureFlag = 'licenseActivation' | 'payment';

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (flag === 'licenseActivation') {
    return import.meta.env.VITE_FEATURE_LICENSE === 'true';
  }
  if (flag === 'payment') {
    return import.meta.env.VITE_FEATURE_PAYMENT === 'true';
  }
  return false;
}
