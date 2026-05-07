import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import opentype from "opentype.js";
import Icon from "@/components/ui/icon";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  loadFontFromBuffer,
  buildAnimatableCharsWrapped,
  drawGlyphHandwrite,
  drawGlyphWriteOn,
  drawGlyphFull,
  type AnimatableChar,
  type WriteOnDirection,
} from "@/lib/fontAnimator";

// ── Types ──────────────────────────────────────────────────────────────────────
type AnimMode = "auto" | "manual" | "typewriter";
type AspectRatio = "16:9" | "9:16" | "4:3";
type Section = "editor" | "animation" | "fonts" | "export" | "settings" | "docs";

interface TextStyle {
  bold: boolean;
  italic: boolean;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
}

interface CharAnimSettings {
  direction: WriteOnDirection;
  delay: number; // множитель задержки 0..2
}

const ASPECT_SIZES: Record<AspectRatio, { w: number; h: number }> = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "4:3": { w: 1440, h: 1080 },
};

const DISPLAY_SCALE = 0.4;

const NAV_ITEMS: { id: Section; icon: string; label: string }[] = [
  { id: "editor", icon: "PenLine", label: "Редактор" },
  { id: "animation", icon: "Sparkles", label: "Анимация" },
  { id: "fonts", icon: "Type", label: "Шрифты" },
  { id: "export", icon: "Download", label: "Экспорт" },
  { id: "settings", icon: "SlidersHorizontal", label: "Настройки" },
  { id: "docs", icon: "BookOpen", label: "Справка" },
];

const DEFAULT_STYLE: TextStyle = {
  bold: false,
  italic: false,
  fontSize: 72,
  color: "#000000",
  align: "left",
};

const WRITE_ON_DIRECTIONS: { id: WriteOnDirection; label: string }[] = [
  { id: "left-to-right", label: "← Слева направо" },
  { id: "right-to-left", label: "→ Справа налево" },
  { id: "top-to-bottom", label: "↓ Сверху вниз" },
  { id: "bottom-to-top", label: "↑ Снизу вверх" },
  { id: "diagonal-tl", label: "↘ По диагонали" },
];

const ALL_CHARS = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-:;()\"'";

// ── Компонент ──────────────────────────────────────────────────────────────────
export default function Index() {
  const [section, setSection] = useState<Section>("editor");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Шрифт
  const [font, setFont] = useState<opentype.Font | null>(null);
  const [fontName, setFontName] = useState("");
  const fontInputRef = useRef<HTMLInputElement>(null);

  // Текст (единая строка, перенос автоматически)
  const [text, setText] = useState("");
  const [textStyle, setTextStyle] = useState<TextStyle>({ ...DEFAULT_STYLE });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Фон
  const [bgColor, setBgColor] = useState("#ffffff");
  const [bgTransparent, setBgTransparent] = useState(false);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [bgImageScale, setBgImageScale] = useState([100]); // %
  const bgImageInputRef = useRef<HTMLInputElement>(null);

  // Формат
  const [aspect, setAspect] = useState<AspectRatio>("16:9");

  // Анимация
  const [animMode, setAnimMode] = useState<AnimMode>("auto");
  const [animSpeed, setAnimSpeed] = useState([30]); // 1..100, меньше = медленнее
  const [smoothness, setSmoothness] = useState([60]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const animRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const pausedProgressRef = useRef(0);

  // Ручная настройка анимации
  const [charAnimSettings, setCharAnimSettings] = useState<Record<string, CharAnimSettings>>({});
  const [selectedManualChar, setSelectedManualChar] = useState<string | null>(null);
  const [manualCharFilter, setManualCharFilter] = useState("all");

  // Экспорт
  const [exportFormat, setExportFormat] = useState("mp4");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animCharsRef = useRef<AnimatableChar[]>([]);
  const bgImageElRef = useRef<HTMLImageElement | null>(null);

  // ── Авторасширение textarea ────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [text]);

  // ── Загрузка шрифта ────────────────────────────────────────────────────────
  const handleFontUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const loaded = await loadFontFromBuffer(buf);
    setFont(loaded);
    setFontName(file.name.replace(/\.[^.]+$/, ""));
  }, []);

  // ── Загрузка фонового изображения ─────────────────────────────────────────
  const handleBgImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setBgImage(url);
    const img = new Image();
    img.onload = () => { bgImageElRef.current = img; renderCanvasNow(animProgress); };
    img.src = url;
  }, []); // eslint-disable-line

  // ── Сборка AnimatableChars ─────────────────────────────────────────────────
  const rebuildChars = useCallback(() => {
    if (!font || !text) { animCharsRef.current = []; return; }
    const { w } = ASPECT_SIZES[aspect];
    const chars = buildAnimatableCharsWrapped(
      font, text,
      textStyle.fontSize, textStyle.bold, textStyle.italic,
      textStyle.align, textStyle.color,
      w, 60, 60
    );
    animCharsRef.current = chars;
  }, [font, text, textStyle, aspect]);

  useEffect(() => {
    rebuildChars();
  }, [rebuildChars]);

  // ── Рендер Canvas ──────────────────────────────────────────────────────────
  const renderCanvasNow = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = ASPECT_SIZES[aspect];
    const dpr = DISPLAY_SCALE;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    ctx.clearRect(0, 0, cw, ch);

    // Фон
    if (!bgTransparent) {
      if (bgImageElRef.current && bgImage) {
        const sc = bgImageScale[0] / 100;
        const imgW = bgImageElRef.current.naturalWidth * sc * dpr;
        const imgH = bgImageElRef.current.naturalHeight * sc * dpr;
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(bgImageElRef.current, (cw - imgW) / 2, (ch - imgH) / 2, imgW, imgH);
      } else {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, cw, ch);
      }
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const chars = animCharsRef.current;

    if (!font || !chars.length) {
      // Фолбэк — нативный canvas text
      const lines = text.split("\n");
      lines.forEach((line, li) => {
        const lh = textStyle.fontSize * 1.45;
        const baseline = 60 + li * lh + textStyle.fontSize;
        ctx.font = `${textStyle.italic ? "italic " : ""}${textStyle.bold ? "bold " : ""}${textStyle.fontSize}px sans-serif`;
        ctx.fillStyle = textStyle.color;
        ctx.textAlign = textStyle.align;
        const { w: cWidth } = ASPECT_SIZES[aspect];
        const x = textStyle.align === "center" ? cWidth / 2 : textStyle.align === "right" ? cWidth - 60 : 60;
        ctx.fillText(line, x, baseline);
      });
      ctx.restore();
      return;
    }

    if (animMode === "typewriter" && progress > 0) {
      const n = chars.length;
      const visible = Math.floor(progress * n);
      chars.forEach((ac, i) => {
        const style = textStyle;
        if (i < visible) {
          drawGlyphFull(ctx, ac.glyphPaths[0].commands, style.color);
        } else if (i === visible && progress < 1) {
          ctx.fillStyle = style.color;
          ctx.fillRect(ac.x, ac.y - ac.fontSize, 2.5, ac.fontSize * 1.1);
        }
      });

    } else if (animMode === "auto" && progress > 0) {
      const n = chars.length;
      const ppc = 1 / n; // progress per char
      chars.forEach((ac, i) => {
        const charStart = i * ppc;
        const charEnd = (i + 1) * ppc;
        const strokeW = Math.max(1.5, ac.fontSize * 0.045);

        if (progress >= charEnd) {
          drawGlyphFull(ctx, ac.glyphPaths[0].commands, textStyle.color);
        } else if (progress > charStart) {
          const cp = (progress - charStart) / ppc;
          drawGlyphHandwrite(ctx, ac, cp, textStyle.color, strokeW);
        }
        // < charStart: ничего не рисуем (символ ещё не начат)
      });

    } else if (animMode === "manual" && progress > 0) {
      const n = chars.length;
      const ppc = 1 / n;
      chars.forEach((ac, i) => {
        const charStart = i * ppc;
        const charEnd = (i + 1) * ppc;
        const settings = charAnimSettings[ac.char] ?? { direction: "left-to-right" as WriteOnDirection, delay: 0 };

        if (progress >= charEnd) {
          drawGlyphFull(ctx, ac.glyphPaths[0].commands, textStyle.color);
        } else if (progress > charStart) {
          const cp = (progress - charStart) / ppc;
          drawGlyphWriteOn(ctx, ac, cp, textStyle.color, settings.direction);
        }
      });

    } else {
      // progress=0 или нет анимации — показываем всё финально
      chars.forEach(ac => {
        drawGlyphFull(ctx, ac.glyphPaths[0].commands, textStyle.color);
      });
    }

    ctx.restore();
  }, [aspect, bgColor, bgTransparent, bgImage, bgImageScale, animMode, textStyle, text, font, charAnimSettings]);

  useEffect(() => {
    renderCanvasNow(animProgress);
  }, [animProgress, renderCanvasNow]);

  // Форсируем рендер при смене раздела
  useEffect(() => {
    setTimeout(() => renderCanvasNow(animProgress), 20);
  }, [section]); // eslint-disable-line

  // ── Анимационный цикл ──────────────────────────────────────────────────────
  const getDuration = useCallback(() => {
    // speed 1 = очень медленно (~30с), speed 100 = быстро (~1с)
    // человеческое письмо ≈ speed 20-35
    return 30000 / animSpeed[0];
  }, [animSpeed]);

  const startAnimation = useCallback((fromProgress = 0) => {
    const duration = getDuration();
    const startP = fromProgress;
    startTimeRef.current = performance.now() - startP * duration;

    const tick = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const raw = Math.min(elapsed / duration, 1);
      const sm = smoothness[0] / 100;
      const p = sm > 0.5 ? easeInOut(raw) : raw;
      setAnimProgress(p);

      if (raw < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
        setAnimProgress(1);
      }
    };
    animRef.current = requestAnimationFrame(tick);
  }, [getDuration, smoothness]);

  const togglePlay = () => {
    if (isPlaying) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      pausedProgressRef.current = animProgress;
      setIsPlaying(false);
    } else {
      const from = animProgress >= 1 ? 0 : animProgress;
      if (animProgress >= 1) setAnimProgress(0);
      setIsPlaying(true);
      startAnimation(from);
    }
  };

  const resetAnim = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setIsPlaying(false);
    setAnimProgress(0);
    pausedProgressRef.current = 0;
  };

  // ── Редактирование текста ──────────────────────────────────────────────────
  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey && e.key === "b") { e.preventDefault(); setTextStyle(s => ({ ...s, bold: !s.bold })); }
    if (e.ctrlKey && e.key === "i") { e.preventDefault(); setTextStyle(s => ({ ...s, italic: !s.italic })); }
  };

  const applyStyle = <K extends keyof TextStyle>(key: K, val: TextStyle[K]) => {
    setTextStyle(s => ({ ...s, [key]: val }));
  };

  // ── Экспорт MP4 (через MediaRecorder + Canvas) ─────────────────────────────
  const handleExportVideo = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Создаём full-res offscreen canvas
    const { w, h } = ASPECT_SIZES[aspect];
    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;

    setIsExporting(true);
    setExportProgress(0);

    const fps = 60;
    const duration = getDuration();
    const totalFrames = Math.ceil((duration / 1000) * fps);

    const stream = offscreen.captureStream(fps);
    const mimeType = bgTransparent && exportFormat !== "mp4" ? "video/webm;codecs=vp9" : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.start();

    // Рендерим покадрово
    const renderFrame = (frameIdx: number): Promise<void> =>
      new Promise(resolve => requestAnimationFrame(() => {
        const raw = frameIdx / totalFrames;
        const sm = smoothness[0] / 100;
        const p = sm > 0.5 ? easeInOut(raw) : raw;

        const ctx = offscreen.getContext("2d")!;
        ctx.clearRect(0, 0, w, h);

        if (!bgTransparent) {
          if (bgImageElRef.current && bgImage) {
            const sc = bgImageScale[0] / 100;
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, w, h);
            const imgW = bgImageElRef.current.naturalWidth * sc;
            const imgH = bgImageElRef.current.naturalHeight * sc;
            ctx.drawImage(bgImageElRef.current, (w - imgW) / 2, (h - imgH) / 2, imgW, imgH);
          } else {
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, w, h);
          }
        }

        const chars = animCharsRef.current;
        if (chars.length === 0) { resolve(); return; }

        const n = chars.length;
        const ppc = 1 / n;

        if (animMode === "typewriter" && p > 0) {
          const visible = Math.floor(p * n);
          chars.forEach((ac, i) => {
            if (i < visible) drawGlyphFull(ctx, ac.glyphPaths[0].commands, textStyle.color);
            else if (i === visible && p < 1) {
              ctx.fillStyle = textStyle.color;
              ctx.fillRect(ac.x, ac.y - ac.fontSize, 2.5, ac.fontSize * 1.1);
            }
          });
        } else if (animMode === "auto" && p > 0) {
          chars.forEach((ac, i) => {
            const cs = i * ppc; const ce = (i + 1) * ppc;
            const strokeW = Math.max(1.5, ac.fontSize * 0.045);
            if (p >= ce) drawGlyphFull(ctx, ac.glyphPaths[0].commands, textStyle.color);
            else if (p > cs) drawGlyphHandwrite(ctx, ac, (p - cs) / ppc, textStyle.color, strokeW);
          });
        } else if (animMode === "manual" && p > 0) {
          chars.forEach((ac, i) => {
            const cs = i * ppc; const ce = (i + 1) * ppc;
            const settings = charAnimSettings[ac.char] ?? { direction: "left-to-right" as WriteOnDirection };
            if (p >= ce) drawGlyphFull(ctx, ac.glyphPaths[0].commands, textStyle.color);
            else if (p > cs) drawGlyphWriteOn(ctx, ac, (p - cs) / ppc, textStyle.color, settings.direction);
          });
        } else {
          chars.forEach(ac => drawGlyphFull(ctx, ac.glyphPaths[0].commands, textStyle.color));
        }

        setExportProgress(Math.round((frameIdx / totalFrames) * 100));
        resolve();
      }));

    for (let f = 0; f <= totalFrames; f++) {
      await renderFrame(f);
    }

    recorder.stop();
    await new Promise<void>(res => { recorder.onstop = () => res(); });

    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `script-animation.${exportFormat === "mp4" ? "webm" : exportFormat}`;
    a.click();
    URL.revokeObjectURL(url);

    setIsExporting(false);
    setExportProgress(0);
  }, [aspect, bgColor, bgTransparent, bgImage, bgImageScale, animMode, textStyle, exportFormat, getDuration, smoothness, charAnimSettings]);

  const handleExportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url; a.download = "script-frame.png"; a.click();
  };

  // ── Ручная настройка ────────────────────────────────────────────────────────
  const setCharDir = (ch: string, dir: WriteOnDirection) => {
    setCharAnimSettings(s => ({ ...s, [ch]: { ...(s[ch] ?? { delay: 0 }), direction: dir } }));
  };

  const filteredChars = useMemo(() => {
    const chars = ALL_CHARS.split("");
    if (manualCharFilter === "upper") return chars.filter(c => /[А-ЯA-ZЁ]/.test(c));
    if (manualCharFilter === "lower") return chars.filter(c => /[а-яa-zё]/.test(c));
    if (manualCharFilter === "digits") return chars.filter(c => /[0-9]/.test(c));
    if (manualCharFilter === "punct") return chars.filter(c => /[.,!?;:()"'-]/.test(c));
    return chars;
  }, [manualCharFilter]);

  // ── canvasSize ─────────────────────────────────────────────────────────────
  const canvasSize = useMemo(() => {
    const { w, h } = ASPECT_SIZES[aspect];
    return { w: Math.round(w * DISPLAY_SCALE), h: Math.round(h * DISPLAY_SCALE) };
  }, [aspect]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">

      {/* ── Sidebar ── */}
      <aside className={`flex flex-col border-r border-border flex-shrink-0 transition-all duration-200 ${sidebarOpen ? "w-52" : "w-14"}`}
        style={{ background: "hsl(var(--sidebar-background))" }}>
        <div className="flex items-center gap-2.5 px-3 py-4 border-b border-border">
          <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
            <Icon name="PenLine" size={14} />
          </div>
          {sidebarOpen && <span className="font-semibold text-sm tracking-tight">Скрипт</span>}
        </div>
        <nav className="flex-1 py-2 space-y-0.5 px-1.5">
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => setSection(item.id)}
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded text-sm transition-all ${section === item.id ? "font-medium text-[hsl(var(--ink))]" : "text-[hsl(var(--sidebar-foreground))] hover:text-foreground hover:bg-[hsl(var(--sidebar-accent))]"}`}
              style={section === item.id ? { background: "hsl(158 64% 52% / 0.12)" } : {}}>
              <Icon name={item.icon} size={16} className="flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        <button onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center justify-center h-10 border-t border-border text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">
          <Icon name={sidebarOpen ? "PanelLeftClose" : "PanelLeft"} size={15} />
        </button>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="flex items-center justify-between px-4 h-11 border-b border-border flex-shrink-0"
          style={{ background: "hsl(var(--panel-bg))" }}>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {font ? fontName : "Шрифт не загружен"}
            </span>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">{aspect}</Badge>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
              {animMode === "auto" ? "✍️ Авто" : animMode === "manual" ? "🎛️ Ручная" : "⌨️ Машинка"}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleExportPNG}
              className="text-xs px-2 py-1 rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">
              PNG кадр
            </button>
            <button onClick={handleExportVideo}
              disabled={isExporting}
              className="text-xs px-2.5 py-1 rounded font-medium transition-colors disabled:opacity-50"
              style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
              {isExporting ? `Экспорт ${exportProgress}%…` : "Экспорт видео"}
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">

          {/* ═══════════ EDITOR ═══════════ */}
          {section === "editor" && (
            <div className="flex-1 flex overflow-hidden animate-fade-in">

              {/* Left panel */}
              <div className="w-80 flex-shrink-0 flex flex-col border-r border-border overflow-y-auto"
                style={{ background: "hsl(var(--panel-bg))" }}>

                {/* Font upload */}
                <div className="px-4 pt-4 pb-3 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Шрифт</p>
                  <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff" className="hidden" onChange={handleFontUpload} />
                  <button onClick={() => fontInputRef.current?.click()}
                    className="w-full py-2 rounded border-2 border-dashed border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ink-dim))] hover:text-foreground transition-colors flex items-center justify-center gap-2">
                    <Icon name="Upload" size={13} />
                    {font ? `Заменить: ${fontName}` : "Загрузить .ttf / .otf / .woff"}
                  </button>
                </div>

                {/* Animation mode */}
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Режим анимации</p>
                  <div className="flex gap-1">
                    {([["auto", "✍️ Авто"], ["manual", "🎛️ Ручная"], ["typewriter", "⌨️ Машинка"]] as [AnimMode, string][]).map(([id, label]) => (
                      <button key={id} onClick={() => setAnimMode(id)}
                        className="flex-1 py-1.5 text-[11px] rounded border transition-colors text-center"
                        style={animMode === id
                          ? { borderColor: "hsl(var(--ink))", color: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" }
                          : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Speed (в редакторе) */}
                <div className="px-4 py-3 border-b border-border">
                  <div className="flex justify-between mb-1.5">
                    <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Скорость анимации</p>
                    <span className="text-[11px] font-mono-code" style={{ color: "hsl(var(--ink))" }}>{animSpeed[0]}</span>
                  </div>
                  <Slider value={animSpeed} onValueChange={setAnimSpeed} min={1} max={100} step={1} />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Медленно</span>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Быстро</span>
                  </div>
                </div>

                {/* Formatting */}
                <div className="px-4 py-2.5 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Форматирование</p>
                  <div className="flex items-center gap-1 flex-wrap mb-3">
                    <button onClick={() => applyStyle("bold", !textStyle.bold)}
                      className={`px-2 py-1 rounded text-xs font-bold transition-colors ${textStyle.bold ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                      style={textStyle.bold ? { background: "hsl(158 64% 52% / 0.1)" } : {}}>B</button>
                    <button onClick={() => applyStyle("italic", !textStyle.italic)}
                      className={`px-2 py-1 rounded text-xs italic transition-colors ${textStyle.italic ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                      style={textStyle.italic ? { background: "hsl(158 64% 52% / 0.1)" } : {}}>I</button>
                    <div className="w-px h-4 bg-[hsl(var(--border))]" />
                    {(["left", "center", "right"] as const).map(a => (
                      <button key={a} onClick={() => applyStyle("align", a)}
                        className={`p-1 rounded transition-colors ${textStyle.align === a ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                        style={textStyle.align === a ? { background: "hsl(158 64% 52% / 0.1)" } : {}}>
                        <Icon name={a === "left" ? "AlignLeft" : a === "center" ? "AlignCenter" : "AlignRight"} size={13} />
                      </button>
                    ))}
                    <div className="w-px h-4 bg-[hsl(var(--border))]" />
                    <input type="color" value={textStyle.color} onChange={e => applyStyle("color", e.target.value)}
                      title="Цвет текста"
                      className="w-6 h-6 rounded cursor-pointer border border-[hsl(var(--border))] bg-transparent" />
                  </div>
                  {/* Размер шрифта ползунком */}
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <label className="text-[11px] text-[hsl(var(--muted-foreground))]">Размер шрифта</label>
                      <span className="text-[11px] font-mono-code" style={{ color: "hsl(var(--ink))" }}>{textStyle.fontSize}px</span>
                    </div>
                    <Slider value={[textStyle.fontSize]} onValueChange={([v]) => applyStyle("fontSize", v)} min={12} max={200} step={1} />
                  </div>
                </div>

                {/* Text input */}
                <div className="px-4 py-3 border-b border-border flex-1">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
                    Текст <span className="normal-case">(Enter = новая строка)</span>
                  </p>
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={handleTextKeyDown}
                    className="w-full bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded px-3 py-2.5 text-sm resize-none focus:outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground))] overflow-hidden"
                    style={{
                      fontWeight: textStyle.bold ? "bold" : "normal",
                      fontStyle: textStyle.italic ? "italic" : "normal",
                      textAlign: textStyle.align,
                      color: textStyle.color === "#ffffff" ? "hsl(var(--foreground))" : textStyle.color,
                      borderColor: undefined,
                      minHeight: 80,
                    }}
                    placeholder="Введите текст. Текст автоматически переносится, либо нажмите Enter…"
                  />
                </div>

                {/* Background */}
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Фон</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <button onClick={() => setBgTransparent(!bgTransparent)}
                      className="px-2.5 py-1.5 rounded text-[11px] border transition-colors flex items-center gap-1.5"
                      style={bgTransparent
                        ? { borderColor: "hsl(var(--ink))", color: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" }
                        : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                      <Icon name="Layers" size={11} />Прозрачный
                    </button>
                    {!bgTransparent && (
                      <div className="flex items-center gap-1.5">
                        <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                          className="w-7 h-7 rounded cursor-pointer border border-[hsl(var(--border))] bg-transparent" />
                        <span className="text-[11px] font-mono-code text-[hsl(var(--muted-foreground))]">{bgColor}</span>
                      </div>
                    )}
                  </div>
                  <input ref={bgImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgImageUpload} />
                  <button onClick={() => bgImageInputRef.current?.click()}
                    className="w-full py-1.5 text-[11px] rounded border border-dashed border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ink-dim))] hover:text-foreground transition-colors flex items-center justify-center gap-1.5 mb-2">
                    <Icon name="ImagePlus" size={12} />
                    {bgImage ? "Заменить фоновое изображение" : "Загрузить фоновое изображение"}
                  </button>
                  {bgImage && (
                    <div>
                      <div className="flex justify-between mb-1">
                        <label className="text-[11px] text-[hsl(var(--muted-foreground))]">Масштаб изображения</label>
                        <span className="text-[11px] font-mono-code" style={{ color: "hsl(var(--ink))" }}>{bgImageScale[0]}%</span>
                      </div>
                      <Slider value={bgImageScale} onValueChange={setBgImageScale} min={10} max={200} step={5} />
                      <button onClick={() => { setBgImage(null); bgImageElRef.current = null; }}
                        className="mt-1.5 text-[11px] text-red-400 hover:text-red-300 transition-colors">
                        Удалить изображение
                      </button>
                    </div>
                  )}
                </div>

                {/* Aspect ratio */}
                <div className="px-4 py-3">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Формат Full HD</p>
                  <div className="flex gap-1.5">
                    {(["16:9", "9:16", "4:3"] as AspectRatio[]).map(a => (
                      <button key={a} onClick={() => setAspect(a)}
                        className="flex-1 py-1.5 text-[11px] rounded border transition-colors font-mono-code"
                        style={aspect === a
                          ? { borderColor: "hsl(var(--ink))", color: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" }
                          : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex-1 flex items-center justify-center overflow-auto p-6 relative"
                  style={{ background: "hsl(220 18% 6%)" }}>
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ backgroundImage: "linear-gradient(hsl(220 12% 18% / 0.2) 1px, transparent 1px), linear-gradient(90deg, hsl(220 12% 18% / 0.2) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
                  <div className="relative shadow-2xl"
                    style={{
                      width: canvasSize.w, height: canvasSize.h,
                      backgroundImage: bgTransparent ? "repeating-conic-gradient(#666 0% 25%, #999 0% 50%) 0 0 / 14px 14px" : undefined,
                      borderRadius: 4,
                      overflow: "hidden",
                    }}>
                    <canvas ref={canvasRef} style={{ width: canvasSize.w, height: canvasSize.h, display: "block" }} />
                  </div>
                </div>

                {/* Playback bar */}
                <div className="flex-shrink-0 px-5 py-3 border-t border-border" style={{ background: "hsl(var(--panel-bg))" }}>
                  <div className="timeline-track mb-3 cursor-pointer"
                    onClick={e => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      if (animRef.current) cancelAnimationFrame(animRef.current);
                      setIsPlaying(false);
                      setAnimProgress(p);
                    }}>
                    <div className="timeline-progress" style={{ width: `${animProgress * 100}%` }} />
                    <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 bg-background"
                      style={{ left: `calc(${animProgress * 100}% - 5px)`, borderColor: "hsl(var(--ink))" }} />
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={resetAnim} className="text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">
                      <Icon name="SkipBack" size={15} />
                    </button>
                    <button onClick={togglePlay}
                      className="w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
                      <Icon name={isPlaying ? "Pause" : "Play"} size={14} />
                    </button>
                    <div className="flex-1" />
                    <span className="text-[11px] font-mono-code text-[hsl(var(--muted-foreground))]">
                      {(animProgress * getDuration() / 1000).toFixed(1)}s / {(getDuration() / 1000).toFixed(1)}s
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ ANIMATION ═══════════ */}
          {section === "animation" && (
            <div className="flex-1 flex overflow-hidden animate-fade-in">
              {/* Режим */}
              <div className="w-72 flex-shrink-0 border-r border-border overflow-y-auto p-4 space-y-4"
                style={{ background: "hsl(var(--panel-bg))" }}>
                <div>
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Режим</p>
                  <div className="space-y-1.5">
                    {([["auto", "✍️", "Авто-рукопись", "Штрих за штрихом по контурам шрифта"],
                      ["manual", "🎛️", "Ручная настройка", "Write-on для каждой буквы отдельно"],
                      ["typewriter", "⌨️", "Печатная машинка", "Символы появляются по одному"]] as [AnimMode, string, string, string][]).map(([id, icon, name, desc]) => (
                      <div key={id} onClick={() => setAnimMode(id)}
                        className={`mode-card p-3 cursor-pointer ${animMode === id ? "selected" : ""}`}>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span>{icon}</span>
                          <span className="text-sm font-medium">{name}</span>
                        </div>
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))] ml-6">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-[hsl(var(--border))] pt-4 space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs text-foreground">Скорость</label>
                      <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{animSpeed[0]}</span>
                    </div>
                    <Slider value={animSpeed} onValueChange={setAnimSpeed} min={1} max={100} step={1} />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Медленно (~30c)</span>
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Быстро (~0.3c)</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs text-foreground">Плавность (easing)</label>
                      <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{smoothness[0]}%</span>
                    </div>
                    <Slider value={smoothness} onValueChange={setSmoothness} min={0} max={100} step={5} />
                  </div>
                </div>
              </div>

              {/* Ручная настройка */}
              <div className="flex-1 overflow-y-auto p-5">
                {animMode === "manual" ? (
                  <>
                    <h2 className="text-sm font-semibold mb-1">Ручная настройка Write-on</h2>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4">
                      Нажмите на букву или символ и задайте направление проявления — как в Adobe Premiere Pro «Write-on».
                    </p>
                    {/* Фильтр */}
                    <div className="flex gap-1.5 mb-4 flex-wrap">
                      {[["all", "Все"], ["upper", "Заглавные"], ["lower", "Строчные"], ["digits", "Цифры"], ["punct", "Знаки"]].map(([id, label]) => (
                        <button key={id} onClick={() => setManualCharFilter(id)}
                          className="px-2.5 py-1 rounded text-xs border transition-colors"
                          style={manualCharFilter === id
                            ? { borderColor: "hsl(var(--ink))", color: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" }
                            : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Сетка символов */}
                    <div className="flex flex-wrap gap-1.5 mb-5">
                      {filteredChars.map(ch => {
                        const hasSetting = !!charAnimSettings[ch];
                        return (
                          <button key={ch} onClick={() => setSelectedManualChar(ch === selectedManualChar ? null : ch)}
                            className="w-10 h-10 rounded border text-base transition-all relative"
                            style={{
                              fontFamily: font ? "serif" : "sans-serif",
                              borderColor: selectedManualChar === ch ? "hsl(var(--ink))" : hasSetting ? "hsl(var(--ink-dim))" : "hsl(var(--border))",
                              background: selectedManualChar === ch ? "hsl(158 64% 52% / 0.15)" : "hsl(var(--surface))",
                              color: "hsl(var(--foreground))",
                            }}>
                            {ch}
                            {hasSetting && (
                              <span className="absolute top-0 right-0 w-2 h-2 rounded-full"
                                style={{ background: "hsl(var(--ink))", transform: "translate(25%, -25%)" }} />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Настройки выбранного символа */}
                    {selectedManualChar && (
                      <div className="rounded-lg border border-[hsl(var(--border))] p-4 max-w-sm animate-slide-up"
                        style={{ background: "hsl(var(--surface))" }}>
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 rounded border border-[hsl(var(--border))] flex items-center justify-center text-2xl bg-background"
                            style={{ fontFamily: font ? "serif" : "sans-serif" }}>
                            {selectedManualChar}
                          </div>
                          <div>
                            <p className="text-sm font-medium">Символ «{selectedManualChar}»</p>
                            <p className="text-xs text-[hsl(var(--muted-foreground))]">Настройте направление Write-on</p>
                          </div>
                        </div>
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2 uppercase tracking-wider">Направление проявления</p>
                        <div className="space-y-1.5">
                          {WRITE_ON_DIRECTIONS.map(d => {
                            const cur = charAnimSettings[selectedManualChar]?.direction ?? "left-to-right";
                            return (
                              <button key={d.id} onClick={() => setCharDir(selectedManualChar, d.id)}
                                className="w-full text-left px-3 py-2 rounded text-xs border transition-colors"
                                style={cur === d.id
                                  ? { borderColor: "hsl(var(--ink))", color: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" }
                                  : { borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                                {d.label}
                              </button>
                            );
                          })}
                        </div>
                        <button onClick={() => {
                          setCharAnimSettings(s => {
                            const next = { ...s };
                            delete next[selectedManualChar];
                            return next;
                          });
                        }} className="mt-3 text-xs text-red-400 hover:text-red-300 transition-colors">
                          Сбросить настройку
                        </button>
                      </div>
                    )}
                    {Object.keys(charAnimSettings).length > 0 && (
                      <div className="mt-4 flex items-center gap-2">
                        <Icon name="CheckCircle" size={13} style={{ color: "hsl(var(--ink))" }} />
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          Настроено {Object.keys(charAnimSettings).length} символов
                        </span>
                        <button onClick={() => setCharAnimSettings({})}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors ml-2">
                          Сбросить всё
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Icon name="Info" size={28} className="mb-3 text-[hsl(var(--muted-foreground))]" />
                    <p className="text-sm text-foreground mb-1">Выберите режим «Ручная настройка»</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">Для настройки Write-on по каждому символу</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════════ FONTS ═══════════ */}
          {section === "fonts" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold">Шрифт</h2>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Загрузите .ttf / .otf / .woff файл</p>
                </div>
                <button onClick={() => fontInputRef.current?.click()}
                  className="text-xs px-3 py-1.5 rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-foreground hover:border-[hsl(var(--ink-dim))] transition-colors flex items-center gap-1.5">
                  <Icon name="Upload" size={12} />
                  Загрузить
                </button>
              </div>
              {font ? (
                <div className="rounded-lg border p-4 mb-4 max-w-md" style={{ borderColor: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.06)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon name="CheckCircle" size={14} style={{ color: "hsl(var(--ink))" }} />
                    <span className="text-sm font-medium">{fontName}</span>
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">SVG-контуры прочитаны. Режим «Авто-рукопись» нарисует каждый символ штрихами по кривым Безье.</p>
                </div>
              ) : (
                <div className="rounded-lg border-2 border-dashed border-[hsl(var(--border))] p-8 text-center max-w-md cursor-pointer hover:border-[hsl(var(--ink-dim))] transition-colors"
                  onClick={() => fontInputRef.current?.click()}>
                  <Icon name="Upload" size={24} className="mx-auto mb-3 text-[hsl(var(--muted-foreground))]" />
                  <p className="text-sm text-foreground mb-1">Загрузите шрифтовой файл</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">.ttf, .otf, .woff</p>
                </div>
              )}
              <div className="rounded-lg border border-[hsl(var(--border))] p-4 max-w-md mt-4" style={{ background: "hsl(var(--surface))" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="Info" size={13} style={{ color: "hsl(var(--ink))" }} />
                  <span className="text-xs font-medium">Как работает анимация</span>
                </div>
                <ul className="text-xs text-[hsl(var(--muted-foreground))] space-y-1.5">
                  <li>• <b className="text-foreground">opentype.js</b> читает векторные контуры букв из файла шрифта</li>
                  <li>• В режиме «Авто» — скелетная прорисовка штрихами по контурам (как пером)</li>
                  <li>• В режиме «Ручная» — маска Write-on с выбором направления для каждого символа</li>
                  <li>• Финальный вид (filled) всегда сохраняется — текст не стирается</li>
                </ul>
              </div>
            </div>
          )}

          {/* ═══════════ EXPORT ═══════════ */}
          {section === "export" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-lg">
              <h2 className="text-sm font-semibold mb-1">Экспорт</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-5">Видео MP4 / WebM или PNG-кадр</p>
              <div className="space-y-5">
                <div>
                  <label className="text-[11px] text-[hsl(var(--muted-foreground))] block mb-2 uppercase tracking-wider">Формат видео</label>
                  <div className="flex gap-2">
                    {["mp4", "webm", "gif"].map(f => (
                      <button key={f} onClick={() => setExportFormat(f)}
                        className="px-3 py-1.5 rounded text-xs font-mono-code border transition-all"
                        style={exportFormat === f
                          ? { background: "hsl(158 64% 52% / 0.12)", borderColor: "hsl(var(--ink))", color: "hsl(var(--ink))" }
                          : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                        .{f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-xs font-medium">Прозрачный фон (Alpha)</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))]">Применяется в .webm</div>
                  </div>
                  <Switch checked={bgTransparent} onCheckedChange={setBgTransparent} />
                </div>
                <div className="space-y-2 py-3 border-y border-[hsl(var(--border))]">
                  {[
                    ["Разрешение", aspect === "16:9" ? "1920×1080" : aspect === "9:16" ? "1080×1920" : "1440×1080"],
                    ["Частота кадров", "60 fps"],
                    ["Длительность", `${(getDuration() / 1000).toFixed(1)} сек`],
                    ["Прозрачность", bgTransparent ? "Да (Alpha-канал)" : "Нет"],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between">
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">{l}</span>
                      <span className="text-xs font-mono-code">{v}</span>
                    </div>
                  ))}
                </div>
                {isExporting && (
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-xs">Рендеринг покадрово…</span>
                      <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{exportProgress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[hsl(var(--border))]">
                      <div className="h-full rounded-full transition-all" style={{ width: `${exportProgress}%`, background: "hsl(var(--ink))" }} />
                    </div>
                  </div>
                )}
                <button onClick={handleExportVideo} disabled={isExporting}
                  className="w-full py-2.5 rounded text-sm font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
                  <Icon name="Film" size={15} />
                  {isExporting ? `Экспорт ${exportProgress}%…` : "Экспорт видео (WebM)"}
                </button>
                <button onClick={handleExportPNG}
                  className="w-full py-2 rounded text-sm border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-foreground hover:border-[hsl(var(--ink-dim))] transition-colors flex items-center justify-center gap-2">
                  <Icon name="Image" size={15} />
                  Скачать PNG (текущий кадр)
                </button>
              </div>
            </div>
          )}

          {/* ═══════════ SETTINGS ═══════════ */}
          {section === "settings" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-lg">
              <h2 className="text-sm font-semibold mb-1">Настройки</h2>
              <div className="space-y-5 mt-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-xs text-foreground">Размер шрифта</label>
                    <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{textStyle.fontSize}px</span>
                  </div>
                  <Slider value={[textStyle.fontSize]} onValueChange={([v]) => applyStyle("fontSize", v)} min={12} max={200} step={1} />
                </div>
                <div className="border-t border-[hsl(var(--border))] pt-4 space-y-3">
                  <label className="text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider block">Интерфейс</label>
                  {[
                    { label: "Сетка в превью", desc: "Направляющие линии" },
                    { label: "Автосохранение", desc: "Каждые 5 минут" },
                  ].map(o => (
                    <div key={o.label} className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium">{o.label}</div>
                        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{o.desc}</div>
                      </div>
                      <Switch />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ DOCS ═══════════ */}
          {section === "docs" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-2xl">
              <h2 className="text-sm font-semibold mb-1">Справка</h2>
              <div className="space-y-1.5 mb-6">
                {[
                  ["Enter", "Новая строка"],
                  ["Ctrl + B", "Жирный"],
                  ["Ctrl + I", "Курсив"],
                  ["Space", "Play / Пауза (в плеере)"],
                ].map(([k, a]) => (
                  <div key={k} className="flex items-center justify-between py-2 border-b border-[hsl(var(--border)/0.5)]">
                    <span className="text-xs">{a}</span>
                    <kbd className="px-2 py-0.5 rounded text-[10px] font-mono-code border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
                      style={{ background: "hsl(var(--surface))" }}>{k}</kbd>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-[hsl(var(--ink-dim)/0.4)] p-4" style={{ background: "hsl(158 64% 52% / 0.06)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="Lightbulb" size={14} style={{ color: "hsl(var(--ink))" }} />
                  <span className="text-xs font-medium">Быстрый старт</span>
                </div>
                <ol className="text-xs text-[hsl(var(--muted-foreground))] space-y-1 list-decimal list-inside">
                  <li>Загрузите рукописный .ttf шрифт</li>
                  <li>Введите текст — он отобразится в превью мгновенно</li>
                  <li>Выберите режим: Авто-рукопись / Ручной / Машинка</li>
                  <li>Нажмите ▶ — текст нарисуется штрих за штрихом</li>
                  <li>Экспортируйте видео или PNG кадр</li>
                </ol>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}