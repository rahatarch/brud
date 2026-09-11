import { ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { sendToExtension } from '../bridge/vscodeBridge';
import getStartedContent from '../content/get-started.md?raw';
import img1 from '../content/screenshots/1.png';
import img2 from '../content/screenshots/2.png';
import img3 from '../content/screenshots/3.png';
import img4 from '../content/screenshots/4.png';
import img5 from '../content/screenshots/5.png';
import img6 from '../content/screenshots/6.png';
import img7 from '../content/screenshots/7.png';
import img8 from '../content/screenshots/8.png';
import img9 from '../content/screenshots/9.png';
import img10 from '../content/screenshots/10.png';
import img11 from '../content/screenshots/11.png';
import img12 from '../content/screenshots/12.png';

const screenshotMap: Record<string, string> = {
  '1.png': img1,
  '2.png': img2,
  '3.png': img3,
  '4.png': img4,
  '5.png': img5,
  '6.png': img6,
  '7.png': img7,
  '8.png': img8,
  '9.png': img9,
  '10.png': img10,
  '11.png': img11,
  '12.png': img12,
};

function GetStartedPanel() {
  const handleBack = () => {
    sendToExtension({ command: 'openMainWindow' });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-2">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text cursor-pointer bg-surface-3 hover:bg-surface-3 border border-border-subtle rounded px-2.5 py-1.5 transition-colors"
        >
          <ArrowLeft size={12} />
          Back
        </button>
        <span className="text-sm font-medium text-text">Get Started with Brud</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-8">
        <div className="prose-custom">
          <ReactMarkdown
            components={{
              h1: ({ children, ...props }) => (
                <h1 className="text-xl font-semibold text-text mt-6 mb-4 first:mt-0" {...props}>
                  {children}
                </h1>
              ),
              h2: ({ children, ...props }) => (
                <h2 className="text-lg font-semibold text-text mt-6 mb-3" {...props}>
                  {children}
                </h2>
              ),
              p: ({ children, ...props }) => (
                <p className="text-sm text-text-secondary leading-relaxed mb-4" {...props}>
                  {children}
                </p>
              ),
              ol: ({ children, ...props }) => (
                <ol className="text-sm text-text-secondary leading-relaxed mb-4 list-decimal pl-5 space-y-1.5" {...props}>
                  {children}
                </ol>
              ),
              ul: ({ children, ...props }) => (
                <ul className="text-sm text-text-secondary leading-relaxed mb-4 list-disc pl-5 space-y-1.5" {...props}>
                  {children}
                </ul>
              ),
              li: ({ children, ...props }) => (
                <li {...props}>{children}</li>
              ),
              code: ({ children, className, ...props }) => {
                const isBlock = className?.includes('language-');
                if (isBlock) {
                  return (
                    <pre className="bg-surface-3 border border-border-subtle rounded-lg p-4 mb-4 overflow-x-auto text-xs text-text-secondary leading-relaxed">
                      <code {...props}>{children}</code>
                    </pre>
                  );
                }
                return (
                  <code className="bg-surface-3 rounded px-1.5 py-0.5 text-xs text-primary" {...props}>
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => <>{children}</>,
              strong: ({ children, ...props }) => (
                <strong className="font-semibold text-text" {...props}>
                  {children}
                </strong>
              ),
              img: ({ src, alt, title }) => {
                if (!src) return null;

                if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
                  return <img src={src} alt={alt ?? ''} title={title} className="rounded-lg border border-border-subtle my-4 max-w-full" />;
                }

                const filename = src.split('/').pop() ?? src;
                const resolved = screenshotMap[filename];
                if (!resolved) return null;

                return <img src={resolved} alt={alt ?? ''} title={title} className="rounded-lg border border-border-subtle my-4 max-w-full" />;
              },
            }}
          >
            {getStartedContent}
          </ReactMarkdown>

          <div className="flex flex-col items-center gap-3 mt-8 pb-6">
            <button
              onClick={() => sendToExtension({ command: 'openPromptLibrary' })}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white rounded-md bg-primary hover:bg-primary-hover transition-all cursor-pointer"
            >
              Open Prompt Library
            </button>
            <a
              href="https://github.com/rahatarch/brud"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-primary bg-primary/20 rounded-md hover:brightness-110 transition-all"
            >
              Star Brud Code on GitHub
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GetStartedPanel;