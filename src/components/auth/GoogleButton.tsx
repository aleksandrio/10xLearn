// "Continue with Google" — a native form POST to the server-side OAuth trigger
// (`/api/auth/oauth`). No secrets in the client; the button just submits, so it
// is keyboard-operable and works without JS. Rendered on both auth pages beneath
// the email/password form (as a sibling, not nested — forms must not nest).

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C17.1 2.7 14.8 1.7 12 1.7 6.9 1.7 2.7 5.9 2.7 11s4.2 9.3 9.3 9.3c5.4 0 8.9-3.8 8.9-9.1 0-.6-.06-1.1-.15-1.6H12z"
      />
    </svg>
  );
}

export function GoogleButton() {
  return (
    <div className="mt-4">
      <div className="my-4 flex items-center gap-3 text-xs text-blue-100/50">
        <span className="h-px flex-1 bg-white/10" />
        <span>or</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <form method="POST" action="/api/auth/oauth">
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 font-medium text-white transition-colors hover:bg-white/10"
        >
          <GoogleIcon />
          Continue with Google
        </button>
      </form>
    </div>
  );
}
