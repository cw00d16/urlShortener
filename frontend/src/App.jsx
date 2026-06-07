import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { AuthModal } from "./AuthModal";
import { api } from "./api";

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="copy-btn" onClick={copy} title="Copy">
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function Dashboard({ auth }) {
  const [longUrl, setLongUrl]     = useState("");
  const [slug, setSlug]           = useState("");
  const [result, setResult]       = useState(null);
  const [urls, setUrls]           = useState([]);
  const [error, setError]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingUrls, setLoadingUrls] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.listUrls(auth.getToken);
      setUrls(data);
    } catch (e) {
      console.error("Failed to load URLs", e);
    } finally {
      setLoadingUrls(false);
    }
  }, [auth.getToken]);

  useEffect(() => { load(); }, [load]);

  const handleShorten = async () => {
    setError("");
    setResult(null);
    if (!longUrl.trim()) { setError("Paste a URL above."); return; }
    try { new URL(longUrl); }
    catch { setError("Enter a valid URL starting with https://"); return; }

    setSubmitting(true);
    try {
      const data = await api.shorten(longUrl, slug || undefined, auth.getToken);
      setResult(data);
      setLongUrl("");
      setSlug("");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (code) => {
    try {
      await api.deleteUrl(code, auth.getToken);
      setUrls(u => u.filter(x => x.shortCode !== code));
    } catch (e) {
      alert(e.message);
    }
  };

  const shortBase = process.env.REACT_APP_SHORT_BASE ||
    process.env.REACT_APP_API_URL?.replace("/api", "") || "";

  return (
    <div className="dashboard">
      {/* Shorten form */}
      <section className="shorten-section">
        <div className="input-stack">
          <div className="input-group">
            <span className="input-label">URL</span>
            <input
              className="main-input"
              type="text"
              placeholder="https://your-very-long-link.com/goes/here"
              value={longUrl}
              onChange={e => setLongUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleShorten()}
            />
          </div>
          <div className="input-group slug-group">
            <span className="input-label slug-prefix">
              {shortBase}/r/
            </span>
            <input
              className="slug-input"
              type="text"
              placeholder="custom-slug (optional)"
              value={slug}
              onChange={e => setSlug(e.target.value.replace(/[^a-zA-Z0-9-_]/g, ""))}
            />
            <button
              className="shorten-btn"
              onClick={handleShorten}
              disabled={submitting}
            >
              {submitting ? "…" : "Shorten →"}
            </button>
          </div>
        </div>

        {error && <div className="inline-error">{error}</div>}

        {result && (
          <div className="result-banner">
            <div className="result-inner">
              <span className="result-check">✓</span>
              <a
                className="result-url"
                href={result.shortUrl}
                target="_blank"
                rel="noreferrer"
              >
                {result.shortUrl}
              </a>
              <CopyButton text={result.shortUrl} />
            </div>
          </div>
        )}
      </section>

      {/* Links table */}
      <section className="links-section">
        <div className="links-header">
          <h2>Your links {!loadingUrls && <span className="badge">{urls.length}</span>}</h2>
        </div>

        {loadingUrls && <div className="loading-row">Loading…</div>}

        {!loadingUrls && urls.length === 0 && (
          <div className="empty">No links yet — shorten one above.</div>
        )}

        {!loadingUrls && urls.length > 0 && (
          <div className="links-list">
            {urls.map(u => (
              <div className="link-card" key={u.shortCode}>
                <div className="link-top">
                  <a
                    className="link-short"
                    href={`${shortBase}/r/${u.shortCode}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    /r/{u.shortCode}
                  </a>
                  <span className="link-clicks">{u.clickCount ?? 0} clicks</span>
                  <CopyButton text={`${shortBase}/r/${u.shortCode}`} />
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(u.shortCode)}
                    title="Delete"
                  >✕</button>
                </div>
                <div className="link-bottom">
                  <span className="link-long" title={u.longUrl}>{u.longUrl}</span>
                  <span className="link-date">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  if (auth.loading) {
    return (
      <div className="app">
        <div className="splash">Loading…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">⌗</span>snip
          </div>
          <nav className="header-nav">
            {auth.user ? (
              <>
                <span className="user-email">
                  {auth.user.signInDetails?.loginId || auth.user.username}
                </span>
                <button className="nav-btn" onClick={auth.logout}>Sign out</button>
              </>
            ) : (
              <button className="nav-btn primary" onClick={() => setShowAuth(true)}>
                Sign in
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="main">
        {auth.user ? (
          <Dashboard auth={auth} />
        ) : (
          <div className="hero">
            <div className="hero-eyebrow">URL Shortener</div>
            <h1>Short links.<br />Real analytics.</h1>
            <p>Create, track, and manage short URLs backed by<br />AWS Lambda + DynamoDB.</p>
            <button className="hero-btn" onClick={() => setShowAuth(true)}>
              Get started free →
            </button>
            <div className="hero-stack">
              {["S3", "CloudFront", "API Gateway", "Lambda", "DynamoDB", "Cognito"].map(s => (
                <span key={s} className="stack-pill">{s}</span>
              ))}
            </div>
          </div>
        )}
      </main>

      {showAuth && <AuthModal auth={auth} onClose={() => setShowAuth(false)} />}
    </div>
  );
}
