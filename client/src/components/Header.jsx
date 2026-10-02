/**
 * @param {object} props
 * @param {{email: string} | null} props.user
 * @param {() => void} props.onSignIn
 * @param {() => void} props.onSignOut
 */
export function Header({ user, onSignIn, onSignOut }) {
  return (
    <header className="topbar">
      <a className="brand" href="/">
        shrt
      </a>
      <nav id="account" aria-label="Account">
        {user ? (
          <>
            <span className="muted">{user.email}</span>
            <button className="btn small" type="button" onClick={onSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <button className="btn small primary" type="button" onClick={onSignIn}>
            Sign in
          </button>
        )}
      </nav>
    </header>
  );
}
