import { useEffect, useState } from 'react';
import { Expand, Minimize } from 'lucide-react';

type FullscreenDocument = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> | void };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function FullscreenButton() {
  const [active, setActive] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    const update = () => setActive(Boolean(document.fullscreenElement || (document as FullscreenDocument).webkitFullscreenElement));
    update(); document.addEventListener('fullscreenchange', update); document.addEventListener('webkitfullscreenchange', update);
    return () => { document.removeEventListener('fullscreenchange', update); document.removeEventListener('webkitfullscreenchange', update); };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const toggle = async () => {
    setMessage('');
    const doc = document as FullscreenDocument, element = document.documentElement as FullscreenElement;
    try {
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
      } else if (element.requestFullscreen) await element.requestFullscreen();
      else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
      else setMessage('当前浏览器不支持全屏，可继续使用横向页面。');
    } catch { setMessage('当前浏览器暂时无法全屏，可继续使用横向页面。'); }
  };

  return <>
    <button className="page-fullscreen" onClick={toggle} aria-label={active ? '退出全屏' : '全屏显示'} title={active ? '退出全屏' : '全屏显示'} aria-pressed={active}>
      {active ? <Minimize size={18} /> : <Expand size={18} />}
    </button>
    <div className="fullscreen-message" role="status" aria-live="polite">{message}</div>
  </>;
}
