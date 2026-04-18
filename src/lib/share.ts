import toast from 'react-hot-toast';

interface ShareInput {
  title?: string;
  text?: string;
  url: string;
}

// Tries the native Web Share API first (best UX on mobile \u2014 surfaces all
// the user's installed apps). Falls back to clipboard with a toast.
// Returns true if the share completed (or was successfully copied), false
// if the user explicitly cancelled.
export async function shareOrCopy(input: ShareInput): Promise<boolean> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(input);
      return true;
    } catch (e) {
      // AbortError = user dismissed the sheet \u2014 don't fall through to
      // clipboard, that would feel like double action. Any other error
      // (NotAllowedError on iOS Safari in cross-origin iframes, etc.)
      // we treat as "share unavailable" and copy instead.
      if (e instanceof DOMException && e.name === 'AbortError') return false;
    }
  }

  try {
    await navigator.clipboard.writeText(input.url);
    toast.success('Link copied');
    return true;
  } catch {
    toast.error('Could not copy link');
    return false;
  }
}
