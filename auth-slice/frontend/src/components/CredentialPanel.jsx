import { useState } from 'react';

// Shows a system-generated password exactly once. It is held only in component
// state, never stored or logged by the frontend.
export default function CredentialPanel({ title, email, password, onDismiss }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard blocked: the user can still select and copy the text
    }
  };

  return (
    <div className="panel" role="status">
      <h2>{title}</h2>
      <p>Share this password with <strong>{email}</strong> securely. It will <strong>not be shown again</strong>.</p>
      <div className="secret-row">
        <code data-testid="generated-password">{password}</code>
        <button type="button" className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>Done</button>
      </div>
    </div>
  );
}
