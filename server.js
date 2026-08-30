const express=require("express");
const multer=require("multer");
const fs=require("fs");
const path=require("path");
const {spawn}=require("child_process");
const ffmpeg=require("ffmpeg-static");
const ffprobe=require("ffprobe-static").path;

const app=express();
const PORT=process.env.PORT||3000;
const U=path.join(__dirname,"uploads");
const O=path.join(__dirname,"outputs");
fs.mkdirSync(U,{recursive:true});
fs.mkdirSync(O,{recursive:true});
const jobs=new Map();

const upload=multer({
  dest:U,
  limits:{fileSize:1024*1024*1024},
  fileFilter:(req,file,cb)=>{
    const ok=["video/mp4","video/quicktime","video/webm","video/x-matroska"].includes(file.mimetype);
    cb(ok?null:new Error("Тек MP4, MOV, WEBM немесе MKV видео."),ok);
  }
});

const rm=p=>{try{fs.unlinkSync(p)}catch{}};
const makeId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);

app.use(express.static(path.join(__dirname,"public")));
app.use("/downloads",express.static(O));
app.use(express.json());

app.get("/api/health",(req,res)=>res.json({ok:true,brand:"GALA METHOD",engine:"FFmpeg"}));

app.get("/api/stats",(req,res)=>{
  const a=[...jobs.values()];
  res.json({
    total:a.filter(x=>x.status==="done").length,
    processing:a.filter(x=>x.status==="processing").length
  });
});

app.post("/api/upload",upload.single("video"),(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Видео таңдалмаған"});
  const job={id:makeId(),file:req.file.path,name:req.file.originalname,status:"ready",progress:0};
  jobs.set(job.id,job);
  res.json({jobId:job.id,name:job.name});
});

app.post("/api/jobs/:id/start",(req,res)=>{
  const j=jobs.get(req.params.id);
  if(!j)return res.status(404).json({error:"Job табылмады"});
  if(j.status==="processing")return res.status(409).json({error:"Қазір өңделіп жатыр"});

  const b=req.body||{};
  const height=Math.min(2160,Math.max(480,parseInt(b.height)||1080));
  const fps=Math.min(120,Math.max(24,parseInt(b.fps)||60));
  const crf=Math.min(30,Math.max(15,parseInt(b.crf)||18));
  const codec=b.codec==="h265"?"libx265":"libx264";
  const preset=["fast","medium","slow"].includes(b.preset)?b.preset:"medium";

  const outName=`${j.id}-gala-optimized.mp4`;
  const outPath=path.join(O,outName);
  j.status="processing";j.progress=1;j.error=null;j.output=null;

  const args=[
    "-y","-i",j.file,
    "-vf",`scale=-2:${height}:flags=lanczos,fps=${fps}`,
    "-c:v",codec,"-preset",preset,"-crf",String(crf),
    "-pix_fmt","yuv420p","-movflags","+faststart",
    "-c:a","aac","-b:a","192k",
    "-progress","pipe:1","-nostats",outPath
  ];

  const p=spawn(ffmpeg,args);
  let buf="";
  p.stdout.on("data",d=>{
    buf+=d.toString();
    const lines=buf.split(/\r?\n/);buf=lines.pop();
    for(const line of lines){
      const [k,v]=line.split("=");
      if(k==="out_time_ms"){
        // FFmpeg progress is reported as an approximate indicator without duration probing.
        j.progress=Math.min(95,Math.max(j.progress,Math.round(j.progress+1)));
      }
      if(k==="progress"&&v==="end")j.progress=100;
    }
  });

  p.on("error",e=>{j.status="error";j.error=e.message;rm(j.file)});
  p.on("close",code=>{
    rm(j.file);
    if(code===0&&fs.existsSync(outPath)){
      j.status="done";j.progress=100;j.output="/downloads/"+outName;
    }else if(j.status!=="error"){
      j.status="error";j.error="FFmpeg өңдеу қатесі";
    }
  });

  res.json({ok:true});
});

app.get("/api/jobs/:id",(req,res)=>{
  const j=jobs.get(req.params.id);
  if(!j)return res.status(404).json({error:"Job табылмады"});
  res.json({status:j.status,progress:j.progress,error:j.error||null,output:j.output||null});
});

app.use((err,req,res,next)=>res.status(400).json({error:err.message||"Қате"}));

app.listen(PORT,()=>console.log(`GALA METHOD: http://localhost:${PORT}`));
