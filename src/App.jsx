import { useState, useRef } from "react";
import "./App.css";

function parseResult(text) {
  try {
    const m = text.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim().match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (_) {}
  return null;
}

function UploadZone({ label, tag, tagClass, icon, onFile, image, onClear }) {
  const inputRef = useRef();
  const [drag, setDrag] = useState(false);
  const handleDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  };
  return (
    <div
      className={`upload-zone ${drag?"drag-over":""} ${image?"has-image":""}`}
      onClick={() => !image && inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
    >
      {image ? (
        <>
          <img className="preview-img" src={image.url} alt={label} />
          <div className="img-overlay">
            <span className="img-name">{image.file.name}</span>
            <button className="btn-clear" onClick={(e) => { e.stopPropagation(); onClear(); }}>✕ 移除</button>
          </div>
        </>
      ) : (
        <>
          <span className={`upload-tag ${tagClass}`}>{tag}</span>
          <div className="upload-icon">{icon}</div>
          <div className="upload-label">{label}</div>
          <div className="upload-hint">拖拽或点击上传<br />支持 PNG / JPG / WebP</div>
        </>
      )}
      <input ref={inputRef} type="file" accept="image/*" style={{display:"none"}}
        onChange={e => { const f = e.target.files[0]; if (f) onFile(f); }} />
    </div>
  );
}

function IssueCard({ issue }) {
  const typeMap = {spacing:"type-spacing",color:"type-color",typography:"type-typography",layout:"type-layout",component:"type-component",general:"type-general"};
  const typeLabel = {spacing:"间距",color:"颜色",typography:"字体",layout:"布局",component:"组件",general:"其他"};
  const sevMap = {high:"HIGH",medium:"MED",low:"LOW"};
  return (
    <div className={`issue-card ${issue.severity}`}>
      <div className="issue-top">
        <span className={`issue-type ${typeMap[issue.type]||"type-general"}`}>{typeLabel[issue.type]||issue.type}</span>
        <span className="issue-severity">{sevMap[issue.severity]||issue.severity}</span>
      </div>
      <div className="issue-title">{issue.title}</div>
      <div className="issue-desc" dangerouslySetInnerHTML={{__html:(issue.description||"").replace(/`([^`]+)`/g,"<code>$1</code>")}} />
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("pd_key") || "");
  const [designImg, setDesignImg] = useState(null);
  const [implImg, setImplImg] = useState(null);
  const [opacity, setOpacity] = useState(50);
  const [viewMode, setViewMode] = useState("overlay");
  const [loading, setLoading] = useState(false);
  const [loadStep, setLoadStep] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const saveKey = (k) => { setApiKey(k); localStorage.setItem("pd_key", k); };
  const loadImage = (file) => new Promise((res) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res({ file, url, width: img.naturalWidth, height: img.naturalHeight });
    img.src = url;
  });
  const toBase64 = (url) => new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img,0,0);
      res(c.toDataURL("image/jpeg",0.85).split(",")[1]);
    };
    img.onerror = rej; img.src = url;
  });

  const STEPS = [
    {icon:"📐",label:"对齐图像尺寸..."},
    {icon:"🔍",label:"分析设计稿元素..."},
    {icon:"🤖",label:"AI 对比差异中..."},
    {icon:"📊",label:"生成还原度报告..."},
  ];

  const runAnalysis = async () => {
    if (!designImg || !implImg || !apiKey) return;
    setLoading(true); setError(null); setResult(null); setLoadStep(0);
    const timer = setInterval(() => setLoadStep(s => Math.min(s+1, STEPS.length-1)), 1800);
    try {
      const [d64, i64] = await Promise.all([toBase64(designImg.url), toBase64(implImg.url)]);
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 2000,
          system: `你是专业UI还原度分析AI。收到两张图：[DESIGN]设计稿，[IMPL]开发截图。仔细对比，只输出如下JSON，不要其他文字：
{"score":数字0-100,"summary":"总体评价2-3句","issues":[{"type":"spacing|color|typography|layout|component|general","severity":"high|medium|low","title":"问题标题","description":"详细描述，用反引号标注具体数值"}],"highlights":["做得好的点"]}
分析：颜色(背景/文字/边框/渐变)、间距(padding/margin/行高)、字体(字号/字重)、布局(位置/对齐)、组件(按钮/输入框/图标)。只输出JSON。`,
          messages: [{
            role: "user",
            content: [
              {type:"image",source:{type:"base64",media_type:"image/jpeg",data:d64}},
              {type:"text",text:"[DESIGN] 设计师原始设计稿"},
              {type:"image",source:{type:"base64",media_type:"image/jpeg",data:i64}},
              {type:"text",text:"[IMPL] 开发实现截图。分析还原度，输出JSON。"}
            ]
          }]
        })
      });
      clearInterval(timer); setLoadStep(STEPS.length-1);
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      const raw = (data.content||[]).map(b=>b.text||"").join("");
      setResult(parseResult(raw) || {score:null,summary:raw,issues:[],highlights:[]});
    } catch(e) {
      clearInterval(timer);
      setError("分析失败：" + (e.message || "请检查 API Key 或网络"));
    } finally { setLoading(false); }
  };

  const getScoreClass = (s) => s >= 85 ? "score-high" : s >= 65 ? "score-mid" : "score-low";
  const canAnalyze = designImg && implImg && apiKey && !loading;

  return (
    <div className="app">
      <header className="header">
        <div className="logo-mark">PD</div>
        <div>
          <span className="header-title">PixelDiff</span>
          <span className="header-sub"> UI还原度分析工具</span>
        </div>
        <span className="badge">AGENT POWERED</span>
      </header>

      <main className="main">
        <div className="api-key-bar">
          <span className="api-key-label">🔑 API KEY</span>
          <input className="api-key-input" type="password" placeholder="sk-ant-api03-..."
            value={apiKey} onChange={e => saveKey(e.target.value)} />
          <span className="api-key-hint">
            需要 Anthropic API Key &nbsp;·&nbsp;
            <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">获取 →</a>
            &nbsp;·&nbsp; Key 仅存本地浏览器，不上传服务器
          </span>
        </div>

        <div className="upload-grid">
          <UploadZone label="上传设计稿（源图）" tag="DESIGN" tagClass="tag-design" icon="🎨"
            onFile={async f => setDesignImg(await loadImage(f))} image={designImg} onClear={() => setDesignImg(null)} />
          <UploadZone label="上传实现截图（效果图）" tag="IMPL" tagClass="tag-impl" icon="📱"
            onFile={async f => setImplImg(await loadImage(f))} image={implImg} onClear={() => setImplImg(null)} />
        </div>

        <div className="controls-bar">
          <div className="ctrl-group">
            <span className="ctrl-label">叠层透明度</span>
            <input type="range" min="0" max="100" value={opacity} onChange={e => setOpacity(+e.target.value)} />
            <span className="ctrl-value">{opacity}%</span>
          </div>
          {designImg && implImg && (
            <div className="ctrl-group">
              <span className="ctrl-label">宽度比例</span>
              <span className="ctrl-value">{(implImg.width/designImg.width*100).toFixed(0)}%</span>
            </div>
          )}
          <button className="btn-primary" disabled={!canAnalyze} onClick={runAnalysis}>
            {loading ? "⏳ 分析中..." : "🤖 AI 走查对比"}
          </button>
        </div>

        {(designImg || implImg) && (
          <div className="viewer-wrap">
            <div className="viewer-header">
              <span className="viewer-title">VISUAL COMPARE</span>
              <div className="mode-tabs">
                {["overlay","split"].map(m => (
                  <button key={m} className={`mode-tab ${viewMode===m?"active":""}`} onClick={()=>setViewMode(m)}>
                    {m==="overlay"?"叠层":"对比"}
                  </button>
                ))}
              </div>
            </div>
            <div className="viewer-canvas">
              {viewMode==="overlay" && implImg && designImg ? (
                <div className="overlay-stack">
                  <img src={implImg.url} alt="实现" style={{maxHeight:520}} />
                  <img className="overlay-top" src={designImg.url} alt="设计"
                    style={{opacity:opacity/100,transform:`scale(${implImg.width/designImg.width})`,transformOrigin:"top left"}} />
                </div>
              ) : viewMode==="overlay" ? (
                <img src={(implImg||designImg).url} alt="预览" style={{maxHeight:520}} />
              ) : (
                <div className="split-container">
                  <div className="split-pane">{designImg && <img src={designImg.url} alt="设计稿" />}<span className="split-label label-design">DESIGN</span></div>
                  <div className="split-pane">{implImg && <img src={implImg.url} alt="实现" />}<span className="split-label label-impl">IMPL</span></div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="analysis-panel">
          <div className="analysis-header">
            <div className={`status-dot ${loading?"running":result?"done":error?"error":""}`} />
            <span className="analysis-title">ANALYSIS REPORT</span>
          </div>
          <div className="analysis-body">
            {!loading && !result && !error && (
              <div className="empty-state">
                <div className="empty-icon">🔬</div>
                <div className="empty-text">上传设计稿与实现截图，填入 API Key，点击「AI 走查对比」，自动分析颜色、间距、字体、布局等所有元素的还原度</div>
              </div>
            )}
            {loading && (
              <div className="loading-wrap">
                <div className="spinner" />
                <div className="loading-text">Agent 正在分析中...</div>
                <div className="progress-steps">
                  {STEPS.map((s,i) => (
                    <div key={i} className={`step ${i<loadStep?"done":i===loadStep?"active":""}`}>
                      <span className="step-icon">{i<loadStep?"✓":s.icon}</span>
                      <span>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {error && <div className="empty-state"><div className="empty-icon">⚠️</div><div className="empty-text" style={{color:"#FF4D6D"}}>{error}</div></div>}
            {result && !loading && (
              <>
                <div className="score-grid">
                  {result.score != null && (
                    <div className={`score-circle ${getScoreClass(result.score)}`}>
                      <span className="score-num">{result.score}</span>
                      <span className="score-unit">/ 100</span>
                    </div>
                  )}
                  <div className="score-summary" dangerouslySetInnerHTML={{__html:(result.summary||"").replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>")}} />
                </div>
                {result.highlights?.length > 0 && (
                  <><div className="section-label">✅ 还原较好</div>
                  <div className="issues-list">{result.highlights.map((h,i) => (
                    <div key={i} className="issue-card low" style={{borderLeftColor:"#4ADE80"}}>
                      <div className="issue-desc" style={{color:"#A0A8BC"}}>{h}</div>
                    </div>
                  ))}</div></>
                )}
                {["high","medium","low"].map(sev => {
                  const items = (result.issues||[]).filter(x=>x.severity===sev);
                  if (!items.length) return null;
                  const labels = {high:"🔴 严重问题",medium:"🟡 中等问题",low:"🔵 轻微问题"};
                  return <div key={sev}><div className="section-label">{labels[sev]}</div><div className="issues-list">{items.map((issue,i)=><IssueCard key={i} issue={issue}/>)}</div></div>;
                })}
                {!result.issues?.length && <div className="empty-state" style={{padding:"20px"}}><div className="empty-icon">🎉</div><div className="empty-text">未发现明显问题，还原度非常高！</div></div>}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
