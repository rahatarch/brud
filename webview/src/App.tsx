import { Send } from 'lucide-react';

function App() {
  const imageUri = document.getElementById('root')?.getAttribute('data-image-uri') || 'images/brud_compressed_high.png';
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-6">
        <img src={imageUri} alt="Brud Logo" className="w-[100px] h-[100px] mb-6 object-contain" />
        <h1 className="text-[24px] font-semibold text-text mb-3 text-center">
          Welcome to Brud
        </h1>
        <p className="text-[14px] text-text-secondary text-center max-w-[360px] leading-[1.5]">
          Brud is a full AI-assisted coding platform. Paste your Brud Prompt to
          control your codebase automatically.
        </p>
      </div>
      <div className="p-4">
        <div className="relative">
          <textarea
            placeholder="Paste your Brud Prompt here..."
            className="w-full min-h-[100px] rounded-md bg-surface-2 border border-border p-4 resize-none text-text font-sans placeholder:text-text-muted outline-none focus:border-primary"
          />
          <button className="absolute bottom-4 right-3 bg-primary hover:bg-primary-hover active:bg-primary-active text-white w-9 h-9 rounded-md flex items-center justify-center cursor-pointer">
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;