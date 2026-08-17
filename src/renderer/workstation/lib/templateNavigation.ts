import type { NavigateFunction } from 'react-router-dom';
import { useTemplateSessionStore } from '@workstation/state/templateSessionStore';

export type TemplatesLocationState = {
  refreshKey?: number;
};

/** Leave workflow / launcher and land on template center without history back. */
export function goToTemplatesCenter(
  navigate: NavigateFunction,
  options: { refresh?: boolean } = { refresh: true },
) {
  useTemplateSessionStore.getState().resetCurrentTemplate();
  navigate('/templates', {
    replace: true,
    state: options.refresh === false ? undefined : ({ refreshKey: Date.now() } satisfies TemplatesLocationState),
  });
}
