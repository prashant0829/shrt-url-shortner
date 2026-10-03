import { useCallback } from 'react';
import { ToastKind } from '../constants.js';
import { useToast } from '../context/ToastContext.jsx';
import { copyText } from '../lib/clipboard.js';

// Returns `copyToClipboard(text)`, which copies the text and tells the user whether it worked.
export function useCopyToClipboard() {
  const showToast = useToast();

  return useCallback(
    async (text) => {
      const copied = await copyText(text);
      showToast(
        copied
          ? 'Copied to clipboard'
          : 'Could not copy automatically. Select the link and copy it manually.',
        copied ? ToastKind.INFO : ToastKind.ERROR,
      );
    },
    [showToast],
  );
}
