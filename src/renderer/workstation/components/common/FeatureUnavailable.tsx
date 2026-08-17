type FeatureUnavailableProps = {
  featureName: string;
  hint?: string;
};

export function FeatureUnavailable({ featureName, hint }: FeatureUnavailableProps) {
  return (
    <div className="rounded-[12px] border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-warning">
      <strong className="font-medium">{featureName} 暂未开放</strong>
      {hint ? <div className="mt-2">{hint}</div> : null}
    </div>
  );
}
