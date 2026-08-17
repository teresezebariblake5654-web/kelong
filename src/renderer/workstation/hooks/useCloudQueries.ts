import { useQuery } from '@tanstack/react-query';
import { getServices } from '@workstation/services/registry';
import { useWorkflowStore } from '@workstation/state/workflowStore';

export function useWalletQuery(enabled = true) {
  const patch = useWorkflowStore((s) => s.patch);
  return useQuery({
    queryKey: ['wallet'],
    enabled,
    queryFn: async () => {
      const wallet = await getServices().wallet.getWallet();
      patch({ wallet });
      return wallet;
    },
  });
}

export function usePlansQuery(enabled = true) {
  return useQuery({
    queryKey: ['plans'],
    enabled,
    queryFn: () => getServices().wallet.listPlans(),
  });
}

export function useUsageQuery(limit = 50, enabled = true) {
  return useQuery({
    queryKey: ['usage', limit],
    enabled,
    queryFn: () => getServices().wallet.getUsage(limit),
  });
}
