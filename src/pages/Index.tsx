import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

type Section = "editor" | "animation" | "fonts" | "export" | "settings" | "docs";

const NAV_ITEMS: { id: Section; icon: string; label: string }[] = [
  { id: "editor", icon: "PenLine", label: "Редактор" },
  { id: "animation", icon: "Sparkles", label: "Анимация" },
  { id: "fonts", icon: "Type", label: "Шрифты" },
  { id: "export", icon: "Download", label: "Экспорт" },
  { id: "settings", icon: "SlidersHorizontal", label: "Настройки" },
  { id: "docs", icon: "BookOpen", label: "Справка" },
];

const ANIMATION_MODES = [
  { id: "write", name: "Написание", desc: "Перо пишет букву за буквой", icon: "✍️" },
  { id: "fade", name: "Появление", desc: "Плавное появление текста", icon: "🌅" },
  { id: "typewriter", name: "Машинка", desc: "Печать на печатной машинке", icon: "⌨️" },
  { id: "brush", name: "Кисть", desc: "Мазки акварельной кистью", icon: "🎨" },
  { id: "ink", name: "Чернила", desc: "Растекание чернил по бумаге", icon: "🖋️" },
  { id: "neon", name: "Неон", desc: "Световое написание", icon: "💡" },
];

const FONTS = [
  { id: "caveat", name: "Caveat", preview: "Привет, мир!", style: "'Caveat', cursive", tag: "Рукопись" },
  { id: "pacifico", name: "Pacifico", preview: "Привет!", style: "'Pacifico', cursive", tag: "Декоративный" },
  { id: "indie", name: "Indie Flower", preview: "Привет, мир!", style: "'Indie Flower', cursive", tag: "Неформальный" },
  { id: "satisfy", name: "Satisfy", preview: "Привет, мир!", style: "'Satisfy', cursive", tag: "Элегантный" },
];

const TEMPLATES = [
  { id: "quote", name: "Цитата", text: "Жить значит действовать" },
  { id: "greeting", name: "Поздравление", text: "С днём рождения!" },
  { id: "title", name: "Заголовок", text: "Добро пожаловать" },
  { id: "signature", name: "Подпись", text: "С уважением" },
];

const HOTKEYS = [
  { key: "Ctrl + Enter", action: "Запустить превью" },
  { key: "Ctrl + E", action: "Экспорт видео" },
  { key: "Ctrl + Z", action: "Отменить действие" },
  { key: "Ctrl + S", action: "Сохранить проект" },
  { key: "Space", action: "Пауза / воспроизведение" },
  { key: "Ctrl + D", action: "Дублировать слой" },
  { key: "Ctrl + Shift + N", action: "Новый слой" },
  { key: "Delete", action: "Удалить выделенное" },
];

const INITIAL_LAYERS = [
  { id: 1, name: "Текстовый слой 1", visible: true, locked: false },
  { id: 2, name: "Фоновая анимация", visible: true, locked: true },
  { id: 3, name: "Эффект чернил", visible: false, locked: false },
];

export default function Index() {
  const [activeSection, setActiveSection] = useState<Section>("editor");
  const [text, setText] = useState("Привет, это красиво");
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedMode, setSelectedMode] = useState("write");
  const [selectedFont, setSelectedFont] = useState("caveat");
  const [speed, setSpeed] = useState([60]);
  const [fontSize, setFontSize] = useState([48]);
  const [opacity, setOpacity] = useState([100]);
  const [bgColor, setBgColor] = useState("#0f1117");
  const [textColor, setTextColor] = useState("#4ade80");
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const [history] = useState(["Создан проект", "Добавлен текст", "Выбран шрифт Caveat"]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [exportFormat, setExportFormat] = useState("mp4");
  const [exportQuality, setExportQuality] = useState("1080p");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setProgress((p) => {
          if (p >= 100) {
            setIsPlaying(false);
            return 0;
          }
          return p + 0.8;
        });
      }, 50);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying]);

  const togglePlay = () => {
    if (progress >= 100) setProgress(0);
    setIsPlaying(!isPlaying);
  };

  const getPreviewStyle = (): React.CSSProperties => {
    const font = FONTS.find(f => f.id === selectedFont);
    const animProgress = progress / 100;
    return {
      fontFamily: font?.style || "'Caveat', cursive",
      fontSize: `${fontSize[0]}px`,
      color: textColor,
      opacity: selectedMode === "fade" ? animProgress : 1,
      clipPath: (selectedMode === "write" || selectedMode === "typewriter") && progress > 0
        ? `inset(0 ${100 - animProgress * 100}% 0 0)`
        : "none",
    };
  };

  const toggleLayerVisibility = (id: number) => {
    setLayers(layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`flex flex-col transition-all duration-200 border-r border-border flex-shrink-0 ${sidebarOpen ? "w-52" : "w-14"}`}
        style={{ background: "hsl(var(--sidebar-background))" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 py-4 border-b border-border">
          <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
            <Icon name="PenLine" size={14} />
          </div>
          {sidebarOpen && (
            <span className="font-semibold text-sm tracking-tight text-foreground">Скрипт</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 space-y-0.5 px-1.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded text-sm transition-all duration-150 ${
                activeSection === item.id
                  ? "text-[hsl(var(--ink))] font-medium"
                  : "text-[hsl(var(--sidebar-foreground))] hover:text-foreground"
              }`}
              style={activeSection === item.id ? { background: "hsl(158 64% 52% / 0.12)" } : {}}
            >
              <Icon name={item.icon} size={16} className="flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Toggle sidebar */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center justify-center h-10 border-t border-border text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors"
        >
          <Icon name={sidebarOpen ? "PanelLeftClose" : "PanelLeft"} size={15} />
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center justify-between px-4 h-11 border-b border-border flex-shrink-0"
          style={{ background: "hsl(var(--panel-bg))" }}>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">Проект без названия</span>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
              Черновик
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="text-xs px-2.5 py-1 rounded text-[hsl(var(--muted-foreground))] hover:text-foreground hover:bg-[hsl(var(--surface))] transition-colors">
              Сохранить
            </button>
            <button
              className="text-xs px-2.5 py-1 rounded font-medium transition-colors"
              style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}
            >
              Экспорт
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">

          {/* ── EDITOR ── */}
          {activeSection === "editor" && (
            <div className="flex-1 flex gap-0 overflow-hidden animate-fade-in">
              {/* Left panel */}
              <div className="w-72 flex-shrink-0 flex flex-col border-r border-border" style={{ background: "hsl(var(--panel-bg))" }}>
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Текст</p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="w-full h-28 bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded px-3 py-2.5 text-sm resize-none focus:outline-none transition-colors text-foreground placeholder:text-[hsl(var(--muted-foreground))]"
                    style={{ outlineColor: "hsl(var(--ink))" }}
                    placeholder="Введите текст для анимации..."
                  />

                  {/* Templates */}
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2 uppercase tracking-wider">Шаблоны</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {TEMPLATES.map(t => (
                        <button key={t.id} onClick={() => setText(t.text)}
                          className="text-left px-2.5 py-2 rounded text-xs border border-[hsl(var(--border))] bg-[hsl(var(--surface))] hover:border-[hsl(var(--ink-dim))] transition-colors text-foreground">
                          <div className="font-medium">{t.name}</div>
                          <div className="text-[hsl(var(--muted-foreground))] truncate mt-0.5 text-[10px]">{t.text}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Layers */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Слои</p>
                      <button className="transition-opacity hover:opacity-80" style={{ color: "hsl(var(--ink))" }}>
                        <Icon name="Plus" size={13} />
                      </button>
                    </div>
                    <div className="space-y-1">
                      {layers.map(l => (
                        <div key={l.id}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-[hsl(var(--border))]"
                          style={{ background: "hsl(var(--surface))" }}>
                          <button onClick={() => toggleLayerVisibility(l.id)}
                            className="text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">
                            <Icon name={l.visible ? "Eye" : "EyeOff"} size={12} />
                          </button>
                          <span className="text-xs flex-1 truncate text-foreground">{l.name}</span>
                          {l.locked && <Icon name="Lock" size={11} className="text-[hsl(var(--muted-foreground))]" />}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* History */}
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2 uppercase tracking-wider">История</p>
                    <div className="space-y-1">
                      {history.map((h, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] py-1 border-l-2 border-[hsl(var(--border))] pl-2.5">
                          <span className="font-mono-code text-[10px] text-[hsl(var(--ink-dim))]">{String(history.length - i).padStart(2, "0")}</span>
                          {h}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden"
                  style={{ background: "hsl(220 18% 6%)" }}>
                  {/* Grid */}
                  <div className="absolute inset-0 pointer-events-none"
                    style={{
                      backgroundImage: "linear-gradient(hsl(220 12% 18% / 0.3) 1px, transparent 1px), linear-gradient(90deg, hsl(220 12% 18% / 0.3) 1px, transparent 1px)",
                      backgroundSize: "32px 32px"
                    }} />
                  {/* Canvas */}
                  <div className="relative rounded-lg overflow-hidden shadow-2xl flex items-center justify-center"
                    style={{ background: bgColor, width: 600, height: 338, maxWidth: "100%", maxHeight: "100%" }}>
                    <div style={getPreviewStyle()} className="px-8 text-center select-none leading-tight">
                      {text}
                      {isPlaying && selectedMode === "typewriter" && (
                        <span className="cursor-blink ml-0.5" style={{ color: textColor }}>|</span>
                      )}
                    </div>
                    <div className="absolute top-2 right-2 font-mono-code text-[10px] text-white/20">1920×1080</div>
                  </div>
                </div>

                {/* Playback */}
                <div className="flex-shrink-0 px-6 py-3 border-t border-border" style={{ background: "hsl(var(--panel-bg))" }}>
                  <div className="timeline-track mb-3 cursor-pointer"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = ((e.clientX - rect.left) / rect.width) * 100;
                      setProgress(Math.max(0, Math.min(100, pct)));
                    }}>
                    <div className="timeline-progress" style={{ width: `${progress}%` }} />
                    <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 bg-background transition-all"
                      style={{ left: `calc(${progress}% - 5px)`, borderColor: "hsl(var(--ink))" }} />
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setProgress(0)} className="text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">
                      <Icon name="SkipBack" size={15} />
                    </button>
                    <button onClick={togglePlay}
                      className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                      style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
                      <Icon name={isPlaying ? "Pause" : "Play"} size={14} />
                    </button>
                    <button onClick={() => setProgress(100)} className="text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">
                      <Icon name="SkipForward" size={15} />
                    </button>
                    <div className="flex-1" />
                    <span className="font-mono-code text-xs text-[hsl(var(--muted-foreground))]">
                      {(Math.floor(progress / 100 * 50) / 10).toFixed(1)}s / 5.0s
                    </span>
                    <div className="w-px h-4 bg-[hsl(var(--border))]" />
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {ANIMATION_MODES.find(m => m.id === selectedMode)?.name}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── ANIMATION ── */}
          {activeSection === "animation" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
              <h2 className="text-sm font-semibold mb-1 text-foreground">Режим анимации</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4">Выберите способ появления текста</p>
              <div className="grid grid-cols-3 gap-3 mb-8 max-w-2xl">
                {ANIMATION_MODES.map(mode => (
                  <div key={mode.id} onClick={() => setSelectedMode(mode.id)}
                    className={`mode-card p-4 ${selectedMode === mode.id ? "selected" : ""}`}>
                    <div className="text-2xl mb-2">{mode.icon}</div>
                    <div className="text-sm font-medium text-foreground mb-1">{mode.name}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">{mode.desc}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-[hsl(var(--border))] pt-6 space-y-5 max-w-sm">
                <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Параметры</h3>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-xs text-foreground">Скорость анимации</label>
                    <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{speed[0]}%</span>
                  </div>
                  <Slider value={speed} onValueChange={setSpeed} min={10} max={200} step={5} />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-xs text-foreground">Прозрачность</label>
                    <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{opacity[0]}%</span>
                  </div>
                  <Slider value={opacity} onValueChange={setOpacity} min={0} max={100} step={1} />
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-xs font-medium text-foreground">Зацикливание</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))]">Повторять анимацию</div>
                  </div>
                  <Switch />
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-xs font-medium text-foreground">Обратное воспроизведение</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))]">Текст исчезает в конце</div>
                  </div>
                  <Switch />
                </div>
              </div>
            </div>
          )}

          {/* ── FONTS ── */}
          {activeSection === "fonts" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Библиотека шрифтов</h2>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Рукописные и каллиграфические</p>
                </div>
                <button className="text-xs px-3 py-1.5 rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-foreground hover:border-[hsl(var(--ink-dim))] transition-colors flex items-center gap-1.5">
                  <Icon name="Upload" size={12} />
                  Загрузить шрифт
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-6 max-w-2xl">
                {FONTS.map(font => (
                  <div key={font.id} onClick={() => setSelectedFont(font.id)}
                    className={`font-card p-4 ${selectedFont === font.id ? "selected" : ""}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono-code">{font.name}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
                        {font.tag}
                      </Badge>
                    </div>
                    <div className="text-2xl leading-tight" style={{ fontFamily: font.style, color: "hsl(var(--foreground))" }}>
                      {font.preview}
                    </div>
                    {selectedFont === font.id && (
                      <div className="mt-2 flex items-center gap-1" style={{ color: "hsl(var(--ink))" }}>
                        <Icon name="Check" size={11} />
                        <span className="text-[10px]">Активен</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-lg p-4 border border-[hsl(var(--border))] max-w-sm" style={{ background: "hsl(var(--surface))" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="RefreshCw" size={14} style={{ color: "hsl(var(--ink))" }} />
                  <span className="text-xs font-medium text-foreground">Синхронизация</span>
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">Шрифты синхронизируются с Google Fonts и вашими загрузками</p>
                <button className="text-xs px-3 py-1.5 rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">
                  Обновить библиотеку
                </button>
              </div>
            </div>
          )}

          {/* ── EXPORT ── */}
          {activeSection === "export" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-lg">
              <h2 className="text-sm font-semibold mb-1 text-foreground">Экспорт видео</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-6">Настройте параметры и скачайте результат</p>

              <div className="space-y-5">
                <div>
                  <label className="text-[11px] text-[hsl(var(--muted-foreground))] block mb-2 uppercase tracking-wider">Формат</label>
                  <div className="flex gap-2 flex-wrap">
                    {["mp4", "webm", "gif", "mov"].map(f => (
                      <button key={f} onClick={() => setExportFormat(f)}
                        className={`px-3 py-1.5 rounded text-xs font-mono-code transition-all border ${
                          exportFormat === f
                            ? "text-[hsl(var(--ink))]"
                            : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ink-dim))]"
                        }`}
                        style={exportFormat === f ? {
                          background: "hsl(158 64% 52% / 0.12)",
                          borderColor: "hsl(var(--ink))"
                        } : {}}>
                        .{f}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-[hsl(var(--muted-foreground))] block mb-2 uppercase tracking-wider">Качество</label>
                  <div className="flex gap-2 flex-wrap">
                    {["480p", "720p", "1080p", "4K"].map(q => (
                      <button key={q} onClick={() => setExportQuality(q)}
                        className={`px-3 py-1.5 rounded text-xs font-mono-code transition-all border ${
                          exportQuality === q
                            ? "text-[hsl(var(--ink))]"
                            : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ink-dim))]"
                        }`}
                        style={exportQuality === q ? {
                          background: "hsl(158 64% 52% / 0.12)",
                          borderColor: "hsl(var(--ink))"
                        } : {}}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 py-4 border-y border-[hsl(var(--border))]">
                  {[
                    { label: "Формат файла", value: `.${exportFormat.toUpperCase()}` },
                    {
                      label: "Разрешение",
                      value: exportQuality === "4K" ? "3840×2160" : exportQuality === "1080p" ? "1920×1080" : exportQuality === "720p" ? "1280×720" : "854×480"
                    },
                    { label: "Длительность", value: "5.0 сек" },
                    { label: "Частота кадров", value: "60 fps" },
                    { label: "Примерный размер", value: exportQuality === "4K" ? "~85 МБ" : exportQuality === "1080p" ? "~22 МБ" : "~8 МБ" },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between">
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">{row.label}</span>
                      <span className="text-xs font-mono-code text-foreground">{row.value}</span>
                    </div>
                  ))}
                </div>

                <button
                  className="w-full py-2.5 rounded text-sm font-medium transition-all flex items-center justify-center gap-2"
                  style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}
                >
                  <Icon name="Download" size={15} />
                  Скачать видео
                </button>
              </div>
            </div>
          )}

          {/* ── SETTINGS ── */}
          {activeSection === "settings" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-lg">
              <h2 className="text-sm font-semibold mb-1 text-foreground">Параметры</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-6">Фон, цвет, размер кадра и другие опции</p>

              <div className="space-y-6">
                <div>
                  <label className="text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider block mb-3">Цвета</label>
                  <div className="space-y-3">
                    {[
                      { label: "Цвет фона", value: bgColor, onChange: setBgColor },
                      { label: "Цвет текста", value: textColor, onChange: setTextColor },
                    ].map(item => (
                      <div key={item.label} className="flex items-center justify-between">
                        <span className="text-xs text-foreground">{item.label}</span>
                        <div className="flex items-center gap-2">
                          <input type="color" value={item.value} onChange={e => item.onChange(e.target.value)}
                            className="w-7 h-7 rounded cursor-pointer border border-[hsl(var(--border))] bg-transparent" />
                          <span className="text-xs font-mono-code text-[hsl(var(--muted-foreground))]">{item.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[hsl(var(--border))] pt-5">
                  <label className="text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider block mb-3">Размер текста</label>
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-foreground">Размер шрифта</span>
                    <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{fontSize[0]}px</span>
                  </div>
                  <Slider value={fontSize} onValueChange={setFontSize} min={16} max={120} step={2} />
                </div>

                <div className="border-t border-[hsl(var(--border))] pt-5">
                  <label className="text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider block mb-3">Размер кадра</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "16:9", sub: "1920×1080" },
                      { label: "9:16", sub: "1080×1920" },
                      { label: "1:1", sub: "1080×1080" },
                    ].map(f => (
                      <button key={f.label}
                        className="p-3 rounded border border-[hsl(var(--border))] hover:border-[hsl(var(--ink-dim))] transition-colors text-center"
                        style={{ background: "hsl(var(--surface))" }}>
                        <div className="text-sm font-medium text-foreground">{f.label}</div>
                        <div className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">{f.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[hsl(var(--border))] pt-5 space-y-4">
                  <label className="text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider block">Дополнительно</label>
                  {[
                    { label: "Сетка на превью", desc: "Отображать направляющие" },
                    { label: "Звук пера", desc: "Звуки при написании" },
                    { label: "Автосохранение", desc: "Каждые 5 минут" },
                  ].map(opt => (
                    <div key={opt.label} className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-foreground">{opt.label}</div>
                        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{opt.desc}</div>
                      </div>
                      <Switch />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── DOCS ── */}
          {activeSection === "docs" && (
            <div className="flex-1 flex overflow-hidden animate-fade-in">
              <div className="w-44 flex-shrink-0 border-r border-[hsl(var(--border))] py-3 px-2 space-y-0.5"
                style={{ background: "hsl(var(--panel-bg))" }}>
                {["Начало работы", "Редактор", "Анимации", "Шрифты", "Экспорт", "Горячие клавиши"].map(item => (
                  <button key={item}
                    className="w-full text-left px-2.5 py-1.5 rounded text-xs text-[hsl(var(--muted-foreground))] hover:text-foreground hover:bg-[hsl(var(--surface))] transition-colors">
                    {item}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <h2 className="text-sm font-semibold mb-1 text-foreground">Горячие клавиши</h2>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mb-5">Быстрые команды для эффективной работы</p>
                <div className="space-y-1.5 mb-8">
                  {HOTKEYS.map(hk => (
                    <div key={hk.key} className="flex items-center justify-between py-2 border-b border-[hsl(var(--border)/0.5)]">
                      <span className="text-xs text-foreground">{hk.action}</span>
                      <kbd className="px-2 py-0.5 rounded text-[10px] font-mono-code border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
                        style={{ background: "hsl(var(--surface))" }}>
                        {hk.key}
                      </kbd>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg p-4 border max-w-sm" style={{
                  borderColor: "hsl(var(--ink-dim) / 0.4)",
                  background: "hsl(158 64% 52% / 0.06)"
                }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon name="Lightbulb" size={14} style={{ color: "hsl(var(--ink))" }} />
                    <span className="text-xs font-medium text-foreground">Совет</span>
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    Начните с выбора шрифта и режима анимации, затем введите текст и нажмите Space для предпросмотра.
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}