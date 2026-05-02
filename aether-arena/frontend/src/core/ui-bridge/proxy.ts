export function buildProxyHTML(panelId: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden}iframe{border:none;width:100%;height:100%}</style>
</head>
<body>
<script>
if(window.self===window.top){throw new Error("Must run in iframe.")}
const inner=document.createElement("iframe");
inner.setAttribute("sandbox","allow-scripts allow-same-origin allow-forms");
document.body.appendChild(inner);
const PANEL_ID="${panelId}";
window.addEventListener("message",(event)=>{
  if(event.source===window.parent){
    if(event.data&&event.data.method==="ui/notifications/sandbox-resource-ready"){
      inner.srcdoc=event.data.params.html;
    } else if(inner.contentWindow){
      inner.contentWindow.postMessage(event.data,"*");
    }
  } else if(event.source===inner.contentWindow){
    const d=event.data;
    if(d&&d.__aether===true&&d.payload&&typeof d.payload==="object"){
      d.payload.panelId=PANEL_ID;
    }
    window.parent.postMessage(d,"*");
  }
});
window.parent.postMessage({method:"ui/notifications/sandbox-proxy-ready",params:{panelId:PANEL_ID}},"*");
</script>
</body>
</html>`;
}
