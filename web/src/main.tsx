import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import App from './App';
import { loadConfig, type Config } from './config';
import { errorMessage } from './chain';
import './styles.css';
function Boot() {
  const [config, setConfig] = useState<Config>();
  const [error, setError] = useState('');
  useEffect(() => { let active = true; void loadConfig().then(value => { if (active) setConfig(value); }).catch(e => { if (active) setError(errorMessage(e)); }); return () => { active = false; }; }, []);
  if (config) return <App config={config} />;
  return <main className="boot"><span className="wordmark">oneway.</span><h1>{error ? 'Deployment could not be verified' : 'Opening the experiment…'}</h1><p role={error ? 'alert' : 'status'}>{error || 'Loading the deployment manifest and checking its contract ABIs.'}</p>{error && <button className="button primary" onClick={() => location.reload()}>Reload deployment</button>}</main>;
}
createRoot(document.getElementById('root')!).render(<Boot />);
