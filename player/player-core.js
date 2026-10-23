
(() => {
  const TOTAL_FRETS=15;
  const REST_CIRCLE_GAP=5;
  const MIN_DOWNWARD_DROP=8;
  const TUNING=[40,45,50,55,59,64];
  const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const KEYS=[
    ['C/Am',0],['Db/Bbm',1],['D/Bm',2],['Eb/Cm',3],['E/C#m',4],['F/Dm',5],
    ['Gb/Ebm',6],['G/Em',7],['Ab/Fm',8],['A/F#m',9],['Bb/Gm',10],['B/G#m',11]
  ];
  const MAJOR=new Set([0,2,4,5,7,9,11]);

  const EVENT_TYPE=Object.freeze({
    FRAMEWORK_ON:'frameworkOn',
    FRAMEWORK_OFF:'frameworkOff',
    FINGER_ON:'fingerOn',
    FINGER_OFF:'fingerOff',
    MOVE:'move',
    CHORD:'chord',
    REST:'rest'
  });

  const MOVEMENT_TYPE=Object.freeze({
    HAMMER:'hammer-on',
    PULL:'pull-off',
    SLIDE:'slide',
    BEND:'bend'
  });

  const BEND_PHASE=Object.freeze({
    UP:'up',
    RELEASE:'release',
    PRE_RELEASE:'pre-release'
  });

  /*
    0.59 timing boundary.
    All current behavior remains one performed event = 1000 ms.
    Future tempo / beat-length work should change eventDurationMs() rather
    than scattering new hard-coded waits through playback.
  */
  const SCORE_UNITS_PER_QUARTER=4;
  const SCORE_UNITS_PER_MEASURE=16;
  const SCORE_DURATION_VALUES=[2,3,4,6,8,12,16];
  const SCORE_DEFAULT_DURATION_UNITS=4;

  const SCORE_DURATION_META=Object.freeze({
    1:{name:'sixteenth',symbol:'♬',filled:true,stem:true,flags:2,dotted:false},
    2:{name:'eighth',symbol:'♪',filled:true,stem:true,flags:1,dotted:false},
    3:{name:'dotted eighth',symbol:'♪·',filled:true,stem:true,flags:1,dotted:true},
    4:{name:'quarter',symbol:'♩',filled:true,stem:true,flags:0,dotted:false},
    6:{name:'dotted quarter',symbol:'♩·',filled:true,stem:true,flags:0,dotted:true},
    8:{name:'half',symbol:'𝅗𝅥',filled:false,stem:true,flags:0,dotted:false},
    12:{name:'dotted half',symbol:'𝅗𝅥·',filled:false,stem:true,flags:0,dotted:true},
    16:{name:'whole',symbol:'𝅝',filled:false,stem:false,flags:0,dotted:false}
  });

  const PLAYBACK_TIMING=Object.freeze({
    DEFAULT_EVENT_MS:1000,
    CONNECTED_MARKER_MS:205,
    PULL_PREPARE_MS:470,
    PULL_RELEASE_CUE_MS:55,
    SLIDE_MS:460,
    BEND_MS:460,
    DISCRETE_FADE_MS:70,
    DISCRETE_APPEAR_MS:85,
    PRE_BEND_HOLD_RATIO:1/3
  });

  function isFrameworkEvent(e){
    return !!(
      e &&
      (e.type===EVENT_TYPE.FRAMEWORK_ON || e.type===EVENT_TYPE.FRAMEWORK_OFF)
    );
  }

  function isMoveEvent(e,movement=null){
    if(!e || e.type!==EVENT_TYPE.MOVE) return false;
    return movement===null || e.movement===movement;
  }

  function isChordMoveEvent(e){
    return !!(
      isMoveEvent(e) &&
      e.chordMove===true &&
      Array.isArray(e.chordBefore) &&
      Array.isArray(e.chordAfter)
    );
  }

  function isBendEvent(e,phase=null){
    if(!isMoveEvent(e,MOVEMENT_TYPE.BEND)) return false;
    return phase===null || e.bendPhase===phase;
  }

  function isPreBendEvent(e){
    return isBendEvent(e,BEND_PHASE.PRE_RELEASE);
  }

  function isBendReleaseEvent(e){
    return isBendEvent(e,BEND_PHASE.RELEASE);
  }

  function eventDurationUnits(e){
    if(!e || !isTimedEvent(e)) return 0;
    const units=Number(e.durationUnits);
    return Number.isFinite(units) && units>0
      ? units
      : SCORE_DEFAULT_DURATION_UNITS;
  }

  function eventDurationMs(e){
    return PLAYBACK_TIMING.DEFAULT_EVENT_MS *
      (eventDurationUnits(e)/SCORE_UNITS_PER_QUARTER);
  }

  function scaledPlaybackMs(baseMs,e,minMs=24){
    const scale=eventDurationMs(e)/PLAYBACK_TIMING.DEFAULT_EVENT_MS;
    return Math.max(minMs,baseMs*scale);
  }

  function durationMeta(units){
    return SCORE_DURATION_META[units] || SCORE_DURATION_META[SCORE_DEFAULT_DURATION_UNITS];
  }

  function durationSymbolForEvent(e){
    return durationMeta(eventDurationUnits(e)).symbol;
  }

  function durationNameForEvent(e){
    return durationMeta(eventDurationUnits(e)).name;
  }

  function preBendTiming(e){
    const total=eventDurationMs(e);
    const hold=Math.round(total*PLAYBACK_TIMING.PRE_BEND_HOLD_RATIO);
    return {
      total,
      hold,
      release:Math.max(0,total-hold)
    };
  }

  function eventPhysicalPosition(e){
    if(!e) return null;

    if(e.type===EVENT_TYPE.FINGER_ON){
      return {s:e.s,f:e.f};
    }

    if(isPreBendEvent(e)){
      return clonePos(e.bendHome || e.to);
    }

    if(e.type===EVENT_TYPE.MOVE){
      return clonePos(e.to);
    }

    return null;
  }

  function eventSoundingPosition(e){
    if(!e) return null;

    if(e.type===EVENT_TYPE.FINGER_ON){
      return {s:e.s,f:e.f};
    }

    if(isPreBendEvent(e)){
      return clonePos(e.from);
    }

    if(e.type===EVENT_TYPE.MOVE){
      return clonePos(e.to);
    }

    return null;
  }

  const bd=document.getElementById('board');
  const orow=document.getElementById('openrow');
  const shell=document.getElementById('shell');
  const moveSvg=document.getElementById('moveSvg');
  const keySel=document.getElementById('keySel');
  const adminLabelBtn=document.getElementById('adminLabelBtn');
  const playerLabelBtn=document.getElementById('playerLabelBtn');
  const statusEl=document.getElementById('status');
  const eventPanel=document.getElementById('eventPanel');
  const sequenceWrap=document.querySelector('.sequenceWrap');
  const fretboardWrap=document.querySelector('.maincol .wrap');
  const leftcol=document.querySelector('.leftcol');
  const progressFill=document.getElementById('progressFill');
  const fingerRects=[0,1,2,3].map(i=>document.getElementById('fingerRect'+i));
  const authorModeBtn=document.getElementById('authorModeBtn');
  const movementSection=document.getElementById('movementSection');
  const movementSeparator=document.getElementById('movementSeparator');
  const chordBtn=document.getElementById('chordBtn');
  const scoreToggleBtn=document.getElementById('scoreToggleBtn');
  const restBtn=document.getElementById('restBtn');
  const scoreCloseBtn=document.getElementById('scoreCloseBtn');
  const scoreSection=document.getElementById('scoreSection');
  const scorePopupCard=document.getElementById('scorePopupCard');
  const scoreToolbar=document.getElementById('scoreToolbar');
  const scoreViewport=document.getElementById('scoreViewport');
  const scoreSvg=document.getElementById('scoreSvg');
  const durationEditor=document.getElementById('durationEditor');
  const durationMinus=document.getElementById('durationMinus');
  const durationValue=document.getElementById('durationValue');
  const durationPlus=document.getElementById('durationPlus');
  const fingerAssignMark=document.getElementById('fingerAssignMark');
  const fingerAssignDestinationMark=document.getElementById('fingerAssignDestinationMark');
  const fingerAssignPopup=document.getElementById('fingerAssignPopup');
  const fingerAssignMovement=document.getElementById('fingerAssignMovement');
  const playerKeyBtn=document.getElementById('playerKeyBtn');
  const playerKeyMenu=document.getElementById('playerKeyMenu');
  const clipVariantTag=document.getElementById('clipVariantTag');
  const createOpenBtn=document.getElementById('createOpenBtn');
  const approveClipBtn=document.getElementById('approveClipBtn');
  const recallClipBtn=document.getElementById('recallClipBtn');
  const clipDialog=document.getElementById('clipDialog');
  const clipDialogTitle=document.getElementById('clipDialogTitle');
  const clipDialogText=document.getElementById('clipDialogText');
  const clipDialogCancel=document.getElementById('clipDialogCancel');
  const clipDialogPrimary=document.getElementById('clipDialogPrimary');
  const fingeringConfirmDialog=document.getElementById('fingeringConfirmDialog');
  const fingeringConfirmEdit=document.getElementById('fingeringConfirmEdit');
  const fingeringConfirmContinue=document.getElementById('fingeringConfirmContinue');
  let fingerAssignFlashTimer=null;

  const S={
    tool:'framework',
    pendingMove:null,
    pendingPreBend:null,
    pendingChordMove:null,
    keyPc:0,
    adminLabelMode:'interval',
    playerLabelMode:'interval',
    events:[],
    author:null,
    playback:null,
    runId:0,
    nextBendId:1,
    nextChordId:1,
    previewEventIndex:null,
    editEventIndex:null,
    editSelectionKind:null, // 'timing' | 'edit' | null
    scoreVisible:false,
    scorePopupOffsetY:0,
    playbackEventIndex:null,
    authorEditHistory:{
      framework:[],
      played:[]
    },
    audioUnlocked:false,
    fingerPose:null,
    useAssignedFingering:false,

    // Reusable clip prototype. Admin edits one authored variant at a time.
    clipDraft:{
      editingVariant:'original',
      original:null,
      open:null,
      openShift:null
    },
    playerKeyPc:0,
    playerVariant:'original',
    approvedClip:null,

    fingeringAssign:{
      active:false,
      targets:[],
      cursor:0,
      selectedChordNoteIndex:null,
      assignmentHistory:[],
      completedChordReviewEventIndex:null,
      confirmingChordEventIndex:null
    }
  };

  const FINGER_LETTERS=['I','M','R','P'];

  // Exact line segments currently drawn for chord-assignment fingers.
  // Chord finger taps are resolved geometrically against these shapes,
  // rather than relying on Safari's transformed-element hit testing.
  let chordFingerHitGeometry=[];

  // Safari/iOS commonly emits a synthetic click after pointerup. When the
  // pointerup selected a chord note, suppress exactly that follow-up click so
  // one physical tap can never perform both steps of chord assignment.
  let suppressChordFingerSyntheticClick=false;
  let suppressChordFingerSyntheticClickTimer=null;

  function fingerIndex(value){
    if(Number.isInteger(value) && value>=0 && value<4) return value;
    if(typeof value==='string') return FINGER_LETTERS.indexOf(value.toUpperCase());
    return -1;
  }

  function fingerLetter(value){
    const i=fingerIndex(value);
    return i>=0?FINGER_LETTERS[i]:null;
  }

  function validFingerLetter(value){
    return fingerIndex(value)>=0;
  }

  function blankFingerPose(){
    return {
      held:new Map(),     // finger index -> physical fret position
      baseFret:5,         // index-finger lane; other lanes are +1/+2/+3
      activeString:null,  // controls where uninvolved fingertips retract
      bendFinger:null,
      bendAmount:0        // 0, .5 for half-step, 1 for whole-step
    };
  }

  function blankState(){
    return {
      framework:new Map(),
      fingers:new Map(), // key -> {s,f,kind:'solid'|'bendRing',bendId?,bendFrom?}
      currentOrigin:null
    };
  }
  S.author=blankState();
  S.playback=blankState();
  S.fingerPose=blankFingerPose();

  // Sampled guitar: same loading/playback strategy as Circle v1.114.
  // Try the local Circle repository sample first, then its public Shinyguitar fallback.
  const GUITAR_SAMPLE_DEFS=[
    {
      midi:60,
      local:"samples/guitar/guitar_C4.wav",
      remote:"https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/master/Samples/acoustic/c4_vl3_rr1_1.wav"
    },
    {
      midi:63,
      local:"samples/guitar/guitar_Eb4.wav",
      remote:"https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/master/Samples/acoustic/eb4_vl3_rr1_1.wav"
    },
    {
      midi:66,
      local:"samples/guitar/guitar_Gb4.wav",
      remote:"https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/master/Samples/acoustic/gb4_vl3_rr1_1.wav"
    },
    {
      midi:69,
      local:"samples/guitar/guitar_A4.wav",
      remote:"https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/master/Samples/acoustic/a4_vl3_rr1_1.wav"
    },
    {
      midi:72,
      local:"samples/guitar/guitar_C5.wav",
      remote:"https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/master/Samples/acoustic/c5_vl3_rr1_1.wav"
    },
    {
      midi:75,
      local:"samples/guitar/guitar_Eb5.wav",
      remote:"https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/master/Samples/acoustic/eb5_vl3_rr1_1.wav"
    },
    {
      midi:78,
      local:"samples/guitar/guitar_Gb5.wav",
      remote:"https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/master/Samples/acoustic/gb5_vl3_rr1_1.wav"
    }
  ];

  let guitarAudioCtx=null;
  let guitarMasterGain=null;
  let guitarSampleBuffers=new Map();
  let guitarSamplesPromise=null;
  let activeGuitarSources=[];
  let activeBendAudio=null;

  function getAudioCtx(){
    if(!guitarAudioCtx){
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC) return null;
      guitarAudioCtx=new AC();
      guitarMasterGain=guitarAudioCtx.createGain();
      guitarMasterGain.gain.value=.90;
      guitarMasterGain.connect(guitarAudioCtx.destination);
    }
    return guitarAudioCtx;
  }


  // iOS Safari is stricter than desktop browsers: creating/resuming the
  // AudioContext is not always enough. Start a tiny silent source directly
  // inside the user's tap gesture to unlock later scheduled Web Audio.
  function unlockAudioFromGesture(){
    primeNativeAudioFromGesture();

    const ctx=getAudioCtx();
    if(!ctx) return null;

    try{
      if(ctx.state==="suspended"){
        const p=ctx.resume();
        if(p && typeof p.catch==="function") p.catch(()=>{});
      }

      const buffer=ctx.createBuffer(1,1,ctx.sampleRate||44100);
      const src=ctx.createBufferSource();
      src.buffer=buffer;
      src.connect(ctx.destination);
      src.start(0);
    }catch(_){}

    // Begin sample loading while we are still responding to the user gesture.
    try{ loadGuitarSamples(ctx).catch(()=>{}); }catch(_){}
    return ctx;
  }

  function playFallbackMidi(midi,volume=.11,duration=.46){
    const ctx=getAudioCtx();
    if(!ctx) return false;

    // Never fail silently merely because Safari is still resuming Web Audio.
    if(ctx.state!=="running"){
      try{
        const resumed=ctx.resume();
        if(resumed && typeof resumed.then==="function"){
          resumed.then(()=>{
            if(ctx.state==="running"){
              playFallbackMidi(midi,volume,duration);
            }
          }).catch(err=>console.warn("Fallback audio resume failed:",err));
        }
      }catch(err){
        console.warn("Fallback audio unavailable:",err);
      }
      return false;
    }

    const now=ctx.currentTime+.004;
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    const freq=440*Math.pow(2,(midi-69)/12);

    osc.type="triangle";
    osc.frequency.setValueAtTime(freq,now);

    const peak=Math.max(.015,Math.min(.16,volume*.65));
    const noteDuration=Math.max(.12,duration||.46);

    gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(peak,now+.008);
    gain.gain.exponentialRampToValueAtTime(.0001,now+noteDuration);

    osc.connect(gain);
    gain.connect(guitarMasterGain||ctx.destination);
    osc.start(now);
    osc.stop(now+noteDuration+.02);
    return true;
  }

  function ensureAudioReady(callback){
    const ctx=getAudioCtx();
    if(!ctx) return;

    try{
      if(ctx.state==="suspended"){
        const resumed=ctx.resume();
        if(resumed && typeof resumed.then==="function"){
          resumed.then(()=>{
            S.audioUnlocked=(ctx.state==="running");
            if(callback) callback(ctx);
          }).catch(()=>{});
          return;
        }
      }
    }catch(_){}

    S.audioUnlocked=(ctx.state==="running");
    if(callback) callback(ctx);
  }

  function guitarSampleCandidateUrls(def){
    const urls=[];

    function add(url){
      if(!url) return;
      try{
        const absolute=new URL(url,document.baseURI).href;
        if(!urls.includes(absolute)) urls.push(absolute);
      }catch(_){}
    }

    // 1. Packaged repository sample, relative to the HTML file.
    //    0.87 includes these WAVs in /samples/guitar/.
    add(def.local);

    // 2. GitHub Pages project sites:
    //    https://USER.github.io/Circle/some-folder/file.html
    //    should still find /Circle/samples/guitar/... at repository root.
    try{
      const host=(location.hostname || '').toLowerCase();
      const parts=(location.pathname || '').split('/').filter(Boolean);

      if(host.endsWith('.github.io') && parts.length){
        const repo=parts[0];
        if(repo && !repo.includes('.')){
          add(`${location.origin}/${repo}/${def.local}`);
        }
      }

      // 3. Custom-domain Pages sites and root-hosted copies.
      if(location.origin && /^https?:/i.test(location.origin)){
        add(`${location.origin}/${def.local}`);
      }
    }catch(_){}

    // 4. Existing public sample fallback.
    add(def.remote);

    return urls;
  }

  function fetchAndDecodeGuitarSample(ctx,urls){
    const list=Array.isArray(urls)?urls.slice():[urls];

    const failures=[];

    function tryNext(index){
      if(index>=list.length){
        const detail=failures.length ? failures.join(' | ') : 'no candidate URLs';
        return Promise.reject(new Error("No guitar sample source available: "+detail));
      }

      const url=list[index];
      if(!url) return tryNext(index+1);

      return fetch(url,{
        cache:"default",
        credentials:"omit",
        mode:"cors"
      })
        .then(r=>{
          if(!r.ok) throw new Error(url+" HTTP "+r.status);
          return r.arrayBuffer();
        })
        .then(ab=>ctx.decodeAudioData(ab.slice(0)))
        .catch(err=>{
          failures.push(err && err.message ? err.message : String(err));
          return tryNext(index+1);
        });
    }

    return tryNext(0);
  }

  function loadGuitarSamples(ctx){
    if(guitarSampleBuffers.size===GUITAR_SAMPLE_DEFS.length) return Promise.resolve(true);
    if(guitarSamplesPromise) return guitarSamplesPromise;

    guitarSamplesPromise=Promise.all(GUITAR_SAMPLE_DEFS.map(def=>{
      return fetchAndDecodeGuitarSample(ctx,guitarSampleCandidateUrls(def))
        .then(buf=>{
          guitarSampleBuffers.set(def.midi,buf);
          return true;
        })
        .catch(err=>{
          console.warn("Guitar sample unavailable at MIDI "+def.midi,err);
          guitarSampleBuffers.delete(def.midi);
          return false;
        });
    })).then(results=>{
      return results.some(Boolean);
    }).finally(()=>{
      guitarSamplesPromise=null;
    });

    return guitarSamplesPromise;
  }

  function nearestGuitarSample(midi){
    let best=null;
    for(const def of GUITAR_SAMPLE_DEFS){
      if(!guitarSampleBuffers.has(def.midi)) continue;
      const distance=Math.abs(midi-def.midi);
      if(!best || distance<best.distance) best={def,distance};
    }
    return best;
  }

  const IS_APPLE_WEBKIT=(()=>{
    const ua=navigator.userAgent || '';
    const vendor=navigator.vendor || '';
    return /AppleWebKit/i.test(ua) &&
      (/Apple/i.test(vendor) || /iPhone|iPad|iPod/i.test(ua));
  })();

  const mediaSampleVoices=[];
  let mediaAudioPrimed=false;

  function nearestGuitarSampleDef(midi){
    let best=null;
    for(const def of GUITAR_SAMPLE_DEFS){
      const distance=Math.abs(midi-def.midi);
      if(!best || distance<best.distance) best={def,distance};
    }
    return best;
  }

  function localSampleUrl(def){
    if(!def || !def.local) return '';
    try{
      return new URL(def.local,document.baseURI).href;
    }catch(_){
      return def.local;
    }
  }

  function cleanupMediaVoice(audio){
    const i=mediaSampleVoices.indexOf(audio);
    if(i!==-1) mediaSampleVoices.splice(i,1);
  }

  function playMediaSampledMidi(midi,volume=.20,duration=.72){
    const pick=nearestGuitarSampleDef(midi);
    if(!pick) return false;

    try{
      const audio=new Audio(localSampleUrl(pick.def));
      audio.preload='auto';
      audio.volume=Math.max(0,Math.min(1,volume*2.25));

      // Rate must change pitch for our sparse sample set.
      try{ audio.preservesPitch=false; }catch(_){}
      try{ audio.webkitPreservesPitch=false; }catch(_){}
      try{ audio.mozPreservesPitch=false; }catch(_){}

      const rate=Math.pow(2,(midi-pick.def.midi)/12);
      audio.playbackRate=Math.max(.5,Math.min(2,rate));

      mediaSampleVoices.push(audio);

      const stopAfter=Math.max(.10,duration||.72)*1000;
      const timer=setTimeout(()=>{
        try{ audio.pause(); }catch(_){}
        cleanupMediaVoice(audio);
      },stopAfter+80);

      audio.addEventListener('ended',()=>{
        clearTimeout(timer);
        cleanupMediaVoice(audio);
      },{once:true});

      const promise=audio.play();
      if(promise && typeof promise.catch==='function'){
        promise.catch(err=>{
          clearTimeout(timer);
          cleanupMediaVoice(audio);
          console.warn('Native guitar audio failed:',err);
          playFallbackMidi(midi,volume,duration);
        });
      }

      return true;
    }catch(err){
      console.warn('Native guitar audio unavailable:',err);
      return false;
    }
  }

  function primeNativeAudioFromGesture(){
    if(mediaAudioPrimed) return;
    mediaAudioPrimed=true;

    const def=GUITAR_SAMPLE_DEFS.find(d=>d.midi===69) || GUITAR_SAMPLE_DEFS[0];
    if(!def) return;

    try{
      const audio=new Audio(localSampleUrl(def));
      audio.preload='auto';
      audio.muted=true;
      audio.volume=0;
      try{ audio.preservesPitch=false; }catch(_){}
      try{ audio.webkitPreservesPitch=false; }catch(_){}
      const p=audio.play();

      const finish=()=>{
        try{
          audio.pause();
          audio.currentTime=0;
          audio.muted=false;
        }catch(_){}
      };

      if(p && typeof p.then==='function'){
        p.then(finish).catch(()=>{});
      }else{
        finish();
      }
    }catch(_){}
  }

  function playSampledMidi(midi,volume=.20,duration=.72){
    const ctx=getAudioCtx();

    if(!ctx){
      return playMediaSampledMidi(midi,volume,duration);
    }

    if(ctx.state!=="running"){
      try{
        const p=ctx.resume();
        if(p && typeof p.catch==="function") p.catch(()=>{});
      }catch(_){}
      return playMediaSampledMidi(midi,volume,duration);
    }

    /*
      Web Audio buffer playback is much tighter rhythmically than creating a
      fresh HTMLAudio element for every note. Use it whenever decoded samples
      are ready — including Safari. The native WAV path remains the fallback
      if Safari blocks Web Audio or decoding has not finished.
    */
    const pick=nearestGuitarSample(midi);
    if(!pick){
      if(playMediaSampledMidi(midi,volume,duration)) return true;
      return playFallbackMidi(midi,volume,duration);
    }

    const now=ctx.currentTime+.005;
    const src=ctx.createBufferSource();
    const gain=ctx.createGain();

    src.buffer=guitarSampleBuffers.get(pick.def.midi);
    src.playbackRate.value=Math.pow(2,(midi-pick.def.midi)/12);

    const noteDuration=Math.max(.09,duration||.72);
    const fadeTime=Math.min(.05,noteDuration*.25);
    const fadeStart=now+Math.max(.04,noteDuration-fadeTime);
    const stopAt=now+noteDuration+.012;

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(volume,now);
    gain.gain.setValueAtTime(volume,fadeStart);
    gain.gain.linearRampToValueAtTime(.0001,now+noteDuration);

    src.connect(gain);
    gain.connect(guitarMasterGain||ctx.destination);
    src.start(now);
    try{src.stop(stopAt)}catch(_){}

    const item={src,gain};
    activeGuitarSources.push(item);
    src.onended=()=>{
      const i=activeGuitarSources.indexOf(item);
      if(i!==-1) activeGuitarSources.splice(i,1);
    };
    return true;
  }

  function playStringSample(s,f,volume=.20,duration=.72){
    return playSampledMidi(midiAt(s,f),volume,duration);
  }

  function playUiClick(){
    const ctx=unlockAudioFromGesture() || getAudioCtx();
    if(!ctx) return false;

    const play=()=>{
      if(ctx.state!=="running") return false;

      const now=ctx.currentTime;
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();

      osc.type='square';
      osc.frequency.setValueAtTime(1500,now);
      osc.frequency.exponentialRampToValueAtTime(850,now+.035);

      gain.gain.setValueAtTime(.0001,now);
      gain.gain.exponentialRampToValueAtTime(.055,now+.002);
      gain.gain.exponentialRampToValueAtTime(.0001,now+.042);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now+.05);
      return true;
    };

    if(ctx.state==="running") return play();

    try{
      const p=ctx.resume();
      if(p && typeof p.then==="function"){
        p.then(play).catch(()=>{});
      }
    }catch(_){}

    return false;
  }

  function silenceActiveGuitarSources(fade=.025){
    stopActiveBendAudio(fade);

    for(const audio of [...mediaSampleVoices]){
      try{ audio.pause(); }catch(_){}
      cleanupMediaVoice(audio);
    }

    const ctx=getAudioCtx();
    const now=ctx ? ctx.currentTime : 0;

    for(const item of [...activeGuitarSources]){
      if(!item) continue;
      try{
        if(item.gain && item.gain.gain && ctx){
          const g=item.gain.gain;
          const current=Math.max(.0001,g.value || .0001);
          g.cancelScheduledValues(now);
          g.setValueAtTime(current,now);
          g.linearRampToValueAtTime(.0001,now+fade);
        }
        if(item.src && ctx) item.src.stop(now+fade+.01);
      }catch(_){}
    }
  }

  function trackArticulationSource(src,gain){
    if(!src) return;
    const item={src,gain};
    activeGuitarSources.push(item);
    src.onended=()=>{
      const i=activeGuitarSources.indexOf(item);
      if(i!==-1) activeGuitarSources.splice(i,1);
      if(activeBendAudio && activeBendAudio.src===src) activeBendAudio=null;
    };
  }

  function makeNoiseBuffer(ctx,duration=.08){
    const frames=Math.max(1,Math.floor(ctx.sampleRate*duration));
    const b=ctx.createBuffer(1,frames,ctx.sampleRate);
    const data=b.getChannelData(0);
    for(let i=0;i<frames;i++) data[i]=(Math.random()*2-1);
    return b;
  }

  function playArticulatedMidi(midi,{
    volume=.14,
    duration=.62,
    offset=.05,
    fadeIn=.008
  }={}){
    const ctx=getAudioCtx();
    if(!ctx || ctx.state!=="running"){
      return playMediaSampledMidi(midi,volume,duration);
    }

    const pick=nearestGuitarSample(midi);
    if(!pick){
      if(playMediaSampledMidi(midi,volume,duration)) return true;
      return playFallbackMidi(midi,volume*.85,duration);
    }

    const buffer=guitarSampleBuffers.get(pick.def.midi);
    const usableOffset=Math.max(0,Math.min(offset,Math.max(0,buffer.duration-.10)));
    const available=Math.max(.09,buffer.duration-usableOffset-.015);
    const dur=Math.min(Math.max(.10,duration),available);
    const now=ctx.currentTime+.004;
    const src=ctx.createBufferSource();
    const gain=ctx.createGain();

    src.buffer=buffer;
    src.playbackRate.value=Math.pow(2,(midi-pick.def.midi)/12);

    gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(.008,volume),
      now+Math.max(.004,fadeIn)
    );
    gain.gain.setValueAtTime(
      Math.max(.008,volume),
      now+Math.max(.03,dur-.08)
    );
    gain.gain.exponentialRampToValueAtTime(.0001,now+dur);

    src.connect(gain);
    gain.connect(guitarMasterGain||ctx.destination);
    src.start(now,usableOffset);
    try{src.stop(now+dur+.02)}catch(_){}

    trackArticulationSource(src,gain);
    return true;
  }

  function playHammerImpact(){
    const ctx=getAudioCtx();
    if(!ctx || ctx.state!=="running") return;

    const now=ctx.currentTime+.002;

    // Deeper finger/fretboard thump.
    const thump=ctx.createOscillator();
    const tg=ctx.createGain();
    thump.type='sine';
    thump.frequency.setValueAtTime(88,now);
    thump.frequency.exponentialRampToValueAtTime(54,now+.060);
    tg.gain.setValueAtTime(.0001,now);
    tg.gain.exponentialRampToValueAtTime(.086,now+.004);
    tg.gain.exponentialRampToValueAtTime(.0001,now+.078);
    thump.connect(tg);
    tg.connect(guitarMasterGain||ctx.destination);
    thump.start(now);
    thump.stop(now+.085);
    trackArticulationSource(thump,tg);

    // Mild fret/string click layered above the thump.
    const click=ctx.createBufferSource();
    const bp=ctx.createBiquadFilter();
    const cg=ctx.createGain();
    click.buffer=makeNoiseBuffer(ctx,.030);
    bp.type='bandpass';
    bp.frequency.value=2850;
    bp.Q.value=1.6;
    cg.gain.setValueAtTime(.0001,now);
    cg.gain.exponentialRampToValueAtTime(.020,now+.0015);
    cg.gain.exponentialRampToValueAtTime(.0001,now+.020);
    click.connect(bp);
    bp.connect(cg);
    cg.connect(guitarMasterGain||ctx.destination);
    click.start(now);
    trackArticulationSource(click,cg);

    // Small high-frequency string snap.
    const noise=ctx.createBufferSource();
    const hp=ctx.createBiquadFilter();
    const ng=ctx.createGain();
    noise.buffer=makeNoiseBuffer(ctx,.045);
    hp.type='highpass';
    hp.frequency.value=1700;
    ng.gain.setValueAtTime(.0001,now);
    ng.gain.exponentialRampToValueAtTime(.022,now+.002);
    ng.gain.exponentialRampToValueAtTime(.0001,now+.035);
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(guitarMasterGain||ctx.destination);
    noise.start(now);
    trackArticulationSource(noise,ng);
  }

  function playPullOffClick(){
    const ctx=getAudioCtx();
    if(!ctx || ctx.state!=="running") return;

    const now=ctx.currentTime+.002;

    // Short, dry release click: slightly lower and more tactile than the
    // hammer-on click so it reads as the finger/string letting go.
    const click=ctx.createBufferSource();
    const bp=ctx.createBiquadFilter();
    const gain=ctx.createGain();

    click.buffer=makeNoiseBuffer(ctx,.036);
    bp.type='bandpass';
    bp.frequency.value=2200;
    bp.Q.value=1.8;

    gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(.030,now+.0015);
    gain.gain.exponentialRampToValueAtTime(.0001,now+.026);

    click.connect(bp);
    bp.connect(gain);
    gain.connect(guitarMasterGain||ctx.destination);
    click.start(now);
    trackArticulationSource(click,gain);
  }

  function playSlideSqueak(){
    const ctx=getAudioCtx();
    if(!ctx || ctx.state!=="running") return;

    const now=ctx.currentTime+.002;
    const noise=ctx.createBufferSource();
    const bp=ctx.createBiquadFilter();
    const gain=ctx.createGain();

    noise.buffer=makeNoiseBuffer(ctx,.075);
    bp.type='bandpass';
    bp.frequency.setValueAtTime(2550,now);
    bp.Q.value=5.2;

    gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(.018,now+.006);
    gain.gain.exponentialRampToValueAtTime(.0001,now+.060);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(guitarMasterGain||ctx.destination);
    noise.start(now);
    trackArticulationSource(noise,gain);
  }

  async function playSlideArticulation(e,run){
    const startMidi=midiAt(e.from.s,e.from.f);
    const endMidi=midiAt(e.to.s,e.to.f);
    const distance=Math.abs(endMidi-startMidi);

    // Continue the already-vibrating starting note without replaying its attack.
    playArticulatedMidi(startMidi,{
      volume:.105,
      duration:.28,
      offset:.050,
      fadeIn:.004
    });
    playSlideSqueak();

    if(distance===0) return;

    // Accepted prototype timing: rapid fret-by-fret chromatic transition.
    // Make the travel explicit so descending slides get the same quantized,
    // stepped semitone sequence as ascending slides.
    const stepMs=distance===1?90:42;

    const midis=[];
    if(endMidi>startMidi){
      for(let midi=startMidi+1; midi<=endMidi; midi++) midis.push(midi);
    }else{
      for(let midi=startMidi-1; midi>=endMidi; midi--) midis.push(midi);
    }

    await sleep(58);
    if(run!==S.runId) return;

    for(let i=0;i<midis.length;i++){
      if(run!==S.runId) return;

      const midi=midis[i];
      const isLast=i===midis.length-1;

      playArticulatedMidi(midi,{
        volume:isLast?.135:.085,
        duration:isLast?.58:.12,
        offset:.050,
        fadeIn:.004
      });

      if(!isLast) await sleep(stepMs);
    }
  }

  function stopActiveBendAudio(fade=.025){
    if(!activeBendAudio) return;
    const b=activeBendAudio;
    activeBendAudio=null;

    try{
      const ctx=getAudioCtx();
      const now=ctx?ctx.currentTime:0;
      if(b.gain && ctx){
        b.gain.gain.cancelScheduledValues(now);
        b.gain.gain.setValueAtTime(Math.max(.0001,b.gain.gain.value||.05),now);
        b.gain.gain.exponentialRampToValueAtTime(.0001,now+fade);
      }
      if(b.src) b.src.stop(now+fade+.02);
      if(b.osc) b.osc.stop(now+fade+.02);
    }catch(_){}
  }

  function startBendArticulation(e){
    stopActiveBendAudio(.015);

    const ctx=getAudioCtx();
    if(!ctx || ctx.state!=="running") return false;

    const home=e.bendHome || e.from;
    const startMidi=midiAt(home.s,home.f);
    const endMidi=midiAt(e.to.s,e.to.f);
    const semitones=endMidi-startMidi;
    const bendDuration=.46;
    const now=ctx.currentTime+.004;

    const pick=nearestGuitarSample(startMidi);

    if(!pick){
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      const f0=440*Math.pow(2,(startMidi-69)/12);
      const f1=440*Math.pow(2,(endMidi-69)/12);

      osc.type='triangle';
      osc.frequency.setValueAtTime(f0,now);
      osc.frequency.exponentialRampToValueAtTime(f1,now+bendDuration);

      gain.gain.setValueAtTime(.0001,now);
      gain.gain.exponentialRampToValueAtTime(.105,now+.008);
      gain.gain.setValueAtTime(.105,now+2.0);

      osc.connect(gain);
      gain.connect(guitarMasterGain||ctx.destination);
      osc.start(now);
      osc.stop(now+2.6);

      activeBendAudio={
        osc,gain,
        src:null,
        startMidi,endMidi,
        startFreq:f0,endFreq:f1
      };
      return true;
    }

    const buffer=guitarSampleBuffers.get(pick.def.midi);
    const offset=Math.min(.050,Math.max(0,buffer.duration-.12));
    const src=ctx.createBufferSource();
    const gain=ctx.createGain();

    src.buffer=buffer;

    const baseRate=Math.pow(2,(startMidi-pick.def.midi)/12);
    const targetRate=baseRate*Math.pow(2,semitones/12);

    src.playbackRate.setValueAtTime(baseRate,now);
    src.playbackRate.exponentialRampToValueAtTime(targetRate,now+bendDuration);

    gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(.16,now+.008);
    gain.gain.setValueAtTime(.16,now+2.0);
    gain.gain.exponentialRampToValueAtTime(.0001,now+2.55);

    src.connect(gain);
    gain.connect(guitarMasterGain||ctx.destination);
    src.start(now,offset);
    try{src.stop(now+2.60)}catch(_){}

    activeBendAudio={
      src,gain,osc:null,
      baseRate,targetRate,
      startMidi,endMidi
    };
    trackArticulationSource(src,gain);
    return true;
  }

  function releaseBendArticulation(e){
    const ctx=getAudioCtx();
    const bend=activeBendAudio;

    if(!ctx || ctx.state!=="running" || !bend){
      // If the sustained bend source has already ended, simulate the release
      // with a short attack-suppressed home note.
      const home=e.bendHome || e.to;
      playArticulatedMidi(midiAt(home.s,home.f),{
        volume:.115,duration:.54,offset:.050,fadeIn:.005
      });
      return;
    }

    const now=ctx.currentTime+.004;
    const releaseDuration=.46;

    try{
      if(bend.src){
        bend.src.playbackRate.cancelScheduledValues(now);
        bend.src.playbackRate.setValueAtTime(bend.targetRate,now);
        bend.src.playbackRate.exponentialRampToValueAtTime(bend.baseRate,now+releaseDuration);
      }else if(bend.osc){
        bend.osc.frequency.cancelScheduledValues(now);
        bend.osc.frequency.setValueAtTime(bend.endFreq,now);
        bend.osc.frequency.exponentialRampToValueAtTime(bend.startFreq,now+releaseDuration);
      }

      bend.gain.gain.cancelScheduledValues(now);
      bend.gain.gain.setValueAtTime(Math.max(.025,bend.gain.gain.value||.10),now);
      bend.gain.gain.setValueAtTime(Math.max(.025,bend.gain.gain.value||.10),now+releaseDuration-.03);
      bend.gain.gain.exponentialRampToValueAtTime(.0001,now+releaseDuration+.12);

      if(bend.src) bend.src.stop(now+releaseDuration+.16);
      if(bend.osc) bend.osc.stop(now+releaseDuration+.16);
    }catch(_){}

    activeBendAudio=null;
  }

  function startPreBendReleaseArticulation(
    e,
    holdMs=null,
    releaseMs=null
  ){
    const timing=preBendTiming(e);
    if(!Number.isFinite(holdMs)) holdMs=timing.hold;
    if(!Number.isFinite(releaseMs)) releaseMs=timing.release;
    stopActiveBendAudio(.015);

    const ctx=getAudioCtx();
    if(!ctx || ctx.state!=="running") return false;

    const home=e.bendHome || e.to;
    if(!home || !e.from) return false;

    const startMidi=midiAt(e.from.s,e.from.f);   // already-bent sounding pitch
    const endMidi=midiAt(home.s,home.f);         // physical fretted pitch
    const semitones=endMidi-startMidi;

    const holdDuration=Math.max(0,holdMs/1000);
    const releaseDuration=Math.max(.01,releaseMs/1000);
    const now=ctx.currentTime+.002;
    const releaseStart=now+holdDuration;
    const releaseEnd=releaseStart+releaseDuration;

    const pick=nearestGuitarSample(startMidi);

    if(!pick){
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      const f0=440*Math.pow(2,(startMidi-69)/12);
      const f1=440*Math.pow(2,(endMidi-69)/12);

      osc.type='triangle';
      osc.frequency.setValueAtTime(f0,now);
      osc.frequency.setValueAtTime(f0,releaseStart);
      osc.frequency.exponentialRampToValueAtTime(f1,releaseEnd);

      gain.gain.setValueAtTime(.0001,now);
      gain.gain.exponentialRampToValueAtTime(.13,now+.004);
      gain.gain.setValueAtTime(.13,Math.max(now+.005,releaseEnd-.03));
      gain.gain.exponentialRampToValueAtTime(.0001,releaseEnd+.30);

      osc.connect(gain);
      gain.connect(guitarMasterGain||ctx.destination);
      osc.start(now);
      osc.stop(releaseEnd+.34);

      activeBendAudio={
        osc,gain,src:null,
        startMidi,endMidi,
        startFreq:f0,endFreq:f1
      };
      return true;
    }

    const buffer=guitarSampleBuffers.get(pick.def.midi);
    const src=ctx.createBufferSource();
    const gain=ctx.createGain();

    src.buffer=buffer;

    const startRate=Math.pow(2,(startMidi-pick.def.midi)/12);
    const endRate=startRate*Math.pow(2,semitones/12);

    // First third: stay exactly at the phantom pitch.
    src.playbackRate.setValueAtTime(startRate,now);
    src.playbackRate.setValueAtTime(startRate,releaseStart);

    // Remaining two thirds: continuously relax to the physical fretted pitch.
    src.playbackRate.exponentialRampToValueAtTime(endRate,releaseEnd);

    gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(.18,now+.004);
    gain.gain.setValueAtTime(.18,Math.max(now+.005,releaseEnd-.03));
    gain.gain.exponentialRampToValueAtTime(.0001,releaseEnd+.32);

    src.connect(gain);
    gain.connect(guitarMasterGain||ctx.destination);

    // A pre-bend is explicitly plucked while already bent.
    src.start(now,0);
    try{src.stop(releaseEnd+.38)}catch(_){}

    activeBendAudio={
      src,gain,osc:null,
      baseRate:endRate,
      targetRate:startRate,
      startMidi,endMidi
    };
    trackArticulationSource(src,gain);
    return true;
  }

  function showArticulationSpark(pos){
    if(!pos) return;

    const host=pos.f===0?orow:bd;
    const spark=document.createElement('div');
    spark.className='articulationSpark';

    // Eight white rays burst outward beyond the normal finger-position
    // circumference, then disappear like a miniature firework.
    for(let i=0;i<8;i++){
      const ray=document.createElement('span');
      ray.className='sparkRay';
      ray.style.setProperty('--angle',(i*45)+'deg');
      spark.appendChild(ray);
    }

    spark.style.left=stringXs()[pos.s]+'px';
    spark.style.top=(pos.f===0?32:yForFret(pos.f))+'px';

    host.appendChild(spark);
    setTimeout(()=>{
      if(spark && spark.parentNode) spark.remove();
    },250);
  }

  function playHammerOnArticulation(e){
    // Hammer-on contact occurs at the destination fret.
    showArticulationSpark(e.to);
    playHammerImpact();
    playArticulatedMidi(midiAt(e.to.s,e.to.f),{
      volume:.128,
      duration:.66,
      offset:.055,
      fadeIn:.002
    });
  }

  function playPullOffRelease(e){
    // The visible/audible release happens at the originating fret.
    showArticulationSpark(e.from);
    playPullOffClick();
  }

  function playPullOffResult(e){
    // The lower note speaks only after the pink dot has reached its destination.
    playArticulatedMidi(midiAt(e.to.s,e.to.f),{
      volume:.112,
      duration:.54,
      offset:.045,
      fadeIn:.002
    });
  }

  async function unlockSampleAudio(){
    // Audio permission and sample availability are deliberately independent.
    // On iOS/GitHub Pages a network fetch may finish after the original user
    // gesture. Waiting for WAV loading here can therefore make every path
    // silent even though Web Audio itself is already available.
    const ctx=unlockAudioFromGesture() || getAudioCtx();
    if(!ctx) return false;

    // Start local sample loading immediately after the synchronous unlock.
    let samplesReady=null;
    try{
      samplesReady=loadGuitarSamples(ctx);
    }catch(_){}

    try{
      if(ctx.state==="suspended"){
        await ctx.resume();
      }
    }catch(err){
      console.warn("AudioContext resume failed:",err);
    }

    S.audioUnlocked=(ctx.state==="running");

    /*
      Give the packaged local WAVs a short, bounded opportunity to decode
      before playback begins. This avoids uneven HTMLAudio startup latency
      between successive notes while never making sound depend on decoding.
    */
    if(S.audioUnlocked && samplesReady && typeof samplesReady.then==='function'){
      try{
        await Promise.race([
          samplesReady,
          new Promise(resolve=>setTimeout(resolve,700))
        ]);
      }catch(_){}
    }

    return S.audioUnlocked;
  }

  function auditionDynamicNote(s,f,volume=.20){
    const ctx=unlockAudioFromGesture() || getAudioCtx();
    if(!ctx) return;

    // Keep loading real guitar samples in the background.
    try{ loadGuitarSamples(ctx).catch(()=>{}); }catch(_){}

    const play=()=>{
      if(ctx.state==="running"){
        playStringSample(s,f,volume,.72);
      }
    };

    if(ctx.state==="running"){
      play();
      return;
    }

    try{
      const resumed=ctx.resume();
      if(resumed && typeof resumed.then==="function"){
        resumed.then(play).catch(()=>{});
      }
    }catch(_){}
  }

  function auditionPositions(positions,{
    volume=.20,
    duration=.72
  }={}){
    const valid=(positions || []).filter(p=>
      p &&
      Number.isInteger(p.s) &&
      Number.isFinite(p.f)
    );
    if(!valid.length) return false;

    const ctx=unlockAudioFromGesture() || getAudioCtx();
    if(!ctx) return false;

    try{ loadGuitarSamples(ctx).catch(()=>{}); }catch(_){}

    const play=()=>{
      if(ctx.state!=="running") return false;

      // Chords / multiple positions are deliberately triggered in the same
      // JavaScript turn so they sound together.
      for(const p of valid){
        playStringSample(p.s,p.f,volume,duration);
      }
      return true;
    };

    if(ctx.state==="running"){
      return play();
    }

    try{
      const resumed=ctx.resume();
      if(resumed && typeof resumed.then==="function"){
        resumed.then(play).catch(()=>{});
      }
    }catch(_){}

    return false;
  }

  function eventAuditionPositions(e){
    if(!e || e.type===EVENT_TYPE.REST) return [];

    if(isFrameworkEvent(e)){
      return [{s:e.s,f:e.f}];
    }

    if(e.type===EVENT_TYPE.FINGER_ON || e.type===EVENT_TYPE.FINGER_OFF){
      return [{s:e.s,f:e.f}];
    }

    if(e.type===EVENT_TYPE.CHORD){
      return (e.notes || []).map(clonePos).filter(Boolean);
    }

    if(isMoveEvent(e)){
      // A pre-bend stores the sounding phantom pitch in `from` and the
      // physical lower fret in `to`/`bendHome`. Audition the sounding pitch.
      if(isPreBendEvent(e)){
        return e.from ? [clonePos(e.from)] : [];
      }

      // All other movements resolve to the destination pitch.
      return e.to ? [clonePos(e.to)] : [];
    }

    return [];
  }

  function auditionEventPitch(e,options={}){
    const positions=eventAuditionPositions(e);
    if(!positions.length) return false;

    const isChord=e && e.type===EVENT_TYPE.CHORD;
    return auditionPositions(positions,{
      volume:options.volume ?? (isChord ? .18 : .20),
      duration:options.duration ?? (isChord ? .74 : .72)
    });
  }

  function auditionFingeringTarget(target){
    if(!target) return false;

    const e=S.events[target.eventIndex];
    if(!e) return false;

    if(target.kind==='chord' && Number.isInteger(target.chordNoteIndex)){
      const note=e.notes && e.notes[target.chordNoteIndex];
      return note ? auditionPositions([note]) : false;
    }

    if(target.kind==='chord'){
      return auditionEventPitch(e);
    }

    if(target.pos){
      return auditionPositions([target.pos]);
    }

    return auditionEventPitch(e);
  }

  // Circle primes sample loading on the very first user gesture.
  function primeAudioSamples(){
    const ctx=unlockAudioFromGesture();
    if(!ctx) return;
    ensureAudioReady(readyCtx=>{
      loadGuitarSamples(readyCtx).catch(()=>{});
    });
  }

  document.addEventListener("touchstart",function bootAudio(){
    primeAudioSamples();
    document.removeEventListener("touchstart",bootAudio);
  },{once:true,passive:true});

  document.addEventListener("mousedown",function bootAudioMouse(){
    primeAudioSamples();
    document.removeEventListener("mousedown",bootAudioMouse);
  },{once:true});

  function clonePos(p){return p?{s:p.s,f:p.f}:null}
  function cloneEvents(events){
    return JSON.parse(JSON.stringify(events || []));
  }

  function mod12(n){
    return ((n%12)+12)%12;
  }

  function keyLabelForPc(pc){
    const found=KEYS.find(([,value])=>Number(value)===mod12(pc));
    return found?found[0]:NAMES[mod12(pc)];
  }

  function eachEventPosition(e,fn){
    if(!e || typeof fn!=='function') return;

    if(Number.isFinite(e.f) && Number.isInteger(e.s)){
      fn(e,'f');
    }

    for(const prop of ['from','to','bendHome']){
      const p=e[prop];
      if(p && Number.isFinite(p.f) && Number.isInteger(p.s)){
        fn(p,'f');
      }
    }

    if(e.type==='chord' && Array.isArray(e.notes)){
      for(const note of e.notes){
        if(note && Number.isFinite(note.f) && Number.isInteger(note.s)){
          fn(note,'f');
        }
      }
    }

    if(isChordMoveEvent(e)){
      for(const list of [e.chordBefore,e.chordAfter]){
        for(const note of list || []){
          if(note && Number.isFinite(note.f) && Number.isInteger(note.s)){
            fn(note,'f');
          }
        }
      }
    }
  }

  function lowestFretInEvents(events){
    let min=Infinity;
    for(const e of events || []){
      eachEventPosition(e,p=>{
        min=Math.min(min,p.f);
      });
    }
    return Number.isFinite(min)?min:0;
  }

  function lowestPerformedFretInEvents(events){
    let min=Infinity;

    for(const e of events || []){
      if(
        !e ||
        e.play===false ||
        isFrameworkEvent(e) ||
        e.type===EVENT_TYPE.REST
      ) continue;

      eachEventPosition(e,p=>{
        if(Number.isFinite(p.f)){
          min=Math.min(min,p.f);
        }
      });
    }

    return Number.isFinite(min)?min:0;
  }

  function performedOpenPositionCount(events){
    let count=0;

    for(const e of events || []){
      if(
        !e ||
        e.play===false ||
        isFrameworkEvent(e) ||
        e.type===EVENT_TYPE.REST
      ) continue;

      eachEventPosition(e,p=>{
        if(Number.isFinite(p.f) && p.f===0) count++;
      });
    }

    return count;
  }

  function highestFretInEvents(events){
    let max=-Infinity;
    for(const e of events || []){
      eachEventPosition(e,p=>{
        max=Math.max(max,p.f);
      });
    }
    return Number.isFinite(max)?max:0;
  }

  function shiftEventsByFrets(events,delta){
    const shifted=cloneEvents(events);

    for(const e of shifted){
      eachEventPosition(e,p=>{
        p.f+=delta;
      });
    }

    /*
      When an authored framework extends closer to the nut than the actual
      performed material, transposing the performed phrase to open position
      can move a few green framework events below fret 0. Those positions do
      not exist on the guitar, so omit only those framework events. Performed
      events are protected by lowestPerformedFretInEvents() and therefore
      remain at fret 0 or above.
    */
    return shifted.filter(e=>{
      if(isFrameworkEvent(e)){
        return Number.isFinite(e.f) && e.f>=0 && e.f<=TOTAL_FRETS;
      }
      return true;
    });
  }

  function clearFingerAssignmentsInEvents(events){
    for(const e of events || []){
      if(e.type==='fingerOn'){
        delete e.finger;
      }else if(e.type==='move'){
        delete e.finger;
        delete e.fromFinger;
        delete e.toFinger;
        if(isChordMoveEvent(e)){
          for(const list of [e.chordBefore,e.chordAfter]){
            for(const note of list || []) delete note.finger;
          }
        }
      }else if(e.type==='chord' && Array.isArray(e.notes)){
        e.notes.forEach(note=>delete note.finger);
      }
    }
    return events;
  }

  function snapshotVariantFromAdmin(){
    const variant=S.clipDraft.editingVariant;
    const packet={
      keyPc:mod12(S.keyPc),
      events:cloneEvents(S.events)
    };

    S.clipDraft[variant]=packet;

    if(variant==='original'){
      const min=lowestPerformedFretInEvents(packet.events);
      S.clipDraft.openShift=min;
    }

    return packet;
  }

  function restoreEditingVariantToAdmin(){
    const variant=S.clipDraft.editingVariant;
    const packet=S.clipDraft[variant];
    if(!packet) return false;

    S.events=cloneEvents(packet.events);
    S.keyPc=mod12(packet.keyPc);
    keySel.value=String(S.keyPc);
    rebuildAuthor();
    return true;
  }

  function openVariantKeyPc(){
    if(S.clipDraft.open) return mod12(S.clipDraft.open.keyPc);
    if(!S.clipDraft.original) return null;
    const shift=Number.isFinite(S.clipDraft.openShift)
      ? S.clipDraft.openShift
      : lowestPerformedFretInEvents(S.clipDraft.original.events);
    return mod12(S.clipDraft.original.keyPc-shift);
  }

  function chooseMovableDelta(events,sourceKeyPc,targetKeyPc){
    const min=lowestFretInEvents(events);
    const max=highestFretInEvents(events);
    const residue=mod12(targetKeyPc-sourceKeyPc);
    const candidates=[];

    for(let k=-3;k<=3;k++){
      const delta=residue+12*k;
      const low=min+delta;
      const high=max+delta;

      // Movable form intentionally stays fretted. The exact open-position key
      // is handled by the separately authored open variant.
      if(low>=1 && high<=TOTAL_FRETS){
        candidates.push(delta);
      }
    }

    if(!candidates.length) return null;
    candidates.sort((a,b)=>Math.abs(a)-Math.abs(b) || a-b);
    return candidates[0];
  }

  function eventsForPlayerKey(targetKeyPc){
    const original=S.clipDraft.original;
    if(!original){
      return {
        events:cloneEvents(S.events),
        variant:'original',
        delta:0
      };
    }

    const source=mod12(original.keyPc);
    const target=mod12(targetKeyPc);
    const openKey=openVariantKeyPc();

    // Default/source key ALWAYS shows the authored original position.
    if(target===source){
      return {
        events:cloneEvents(original.events),
        variant:'original',
        delta:0
      };
    }

    // The authored open-string form is used only after the user has changed
    // key to the specific key corresponding to that open position.
    if(S.clipDraft.open && openKey!==null && target===openKey){
      return {
        events:cloneEvents(S.clipDraft.open.events),
        variant:'open',
        delta:0
      };
    }

    const delta=chooseMovableDelta(original.events,source,target);
    if(delta===null){
      return {
        error:'That transposition does not fit on the current 15-fret display.'
      };
    }

    return {
      events:shiftEventsByFrets(original.events,delta),
      variant:'transposed',
      delta
    };
  }

  function loadPlayerKey(targetKeyPc,{quiet=false}={}){
    const result=eventsForPlayerKey(targetKeyPc);
    if(result.error){
      if(!quiet) announce(result.error,false);
      return false;
    }

    stopPlayback(false);

    S.playerKeyPc=mod12(targetKeyPc);
    S.playerVariant=result.variant;
    S.events=cloneEvents(result.events);
    S.keyPc=S.playerKeyPc;

    playerKeyBtn.textContent='Key: '+keyLabelForPc(S.playerKeyPc);
    playerKeyMenu.querySelectorAll('.clipKeyChoice').forEach(btn=>{
      btn.classList.toggle('on',Number(btn.dataset.pc)===S.playerKeyPc);
    });

    if(result.variant==='open'){
      clipVariantTag.textContent='Open-string version';
    }else if(result.variant==='transposed'){
      const sign=result.delta>0?'+':'';
      clipVariantTag.textContent=`Movable version (${sign}${result.delta} frets)`;
    }else{
      clipVariantTag.textContent='Original position';
    }

    S.playback=initialPlayerFrameworkState();
    renderPlayback();
    renderScore();
    progressFill.style.width='0%';

    if(!quiet){
      statusEl.innerHTML=`<strong>${keyLabelForPc(S.playerKeyPc)}</strong><br>${clipVariantTag.textContent}`;
    }
    return true;
  }

  function variantRequiresFinger(e){
    if(!e || e.play===false) return false;

    if(e.type==='fingerOn'){
      return e.f>0;
    }

    if(e.type==='chord'){
      return Array.isArray(e.notes) && e.notes.some(note=>note.f>0);
    }

    if(e.type==='move'){
      if(e.movement==='hammer-on'){
        return !!(e.to && e.to.f>0);
      }
      if(e.movement==='pull-off'){
        return !!(e.to && e.to.f>0);
      }
      if(isPreBendEvent(e)){
        const physical=eventPhysicalPosition(e);
        return !!(physical && physical.f>0);
      }
      if(e.movement==='slide' || e.movement==='bend'){
        return false;
      }
    }

    return false;
  }

  function variantFingeringComplete(events){
    const ev=events || [];
    for(const e of ev){
      if(e.play===false) continue;

      if(e.type==='chord'){
        for(const note of e.notes || []){
          if(note.f>0 && !validFingerLetter(note.finger)) return false;
        }
        continue;
      }

      if(!variantRequiresFinger(e)) continue;
      if(!validFingerLetter(e.finger)) return false;
    }
    return true;
  }

  function buildApprovedClipPacket(){
    return {
      format:'guitar-animation-clip',
      version:1,
      sourceKeyPc:mod12(S.clipDraft.original.keyPc),
      openKeyPc:mod12(S.clipDraft.open.keyPc),
      openShift:S.clipDraft.openShift,
      original:{
        keyPc:mod12(S.clipDraft.original.keyPc),
        events:cloneEvents(S.clipDraft.original.events)
      },
      open:{
        keyPc:mod12(S.clipDraft.open.keyPc),
        events:cloneEvents(S.clipDraft.open.events)
      }
    };
  }

  function posKey(s,f){return `${s}:${f}`}
  function fretY(f){return f/TOTAL_FRETS*bd.clientHeight}
  function stringXs(){const w=bd.clientWidth,m=14,u=w-m*2;return Array.from({length:6},(_,i)=>m+u*i/5)}
  function yForFret(f){return f===0?0:(fretY(f-1)+fretY(f))/2}
  function midiAt(s,f){return TUNING[s]+f}
  function pcAt(s,f){return midiAt(s,f)%12}
  function noteName(s,f){return NAMES[pcAt(s,f)]}
  function isInKey(s,f){return MAJOR.has((pcAt(s,f)-S.keyPc+12)%12)}

  const INTERVAL_LABELS=[
    '1','♭2','2','♭3','3','4','♯4','5','♭6','6','♭7','7'
  ];
  const LABEL_MODE_ORDER=['interval','letter','blank'];

  function labelModeForSurface(surface='auto'){
    const resolved=surface==='auto'
      ? (document.body.classList.contains('player')?'player':'admin')
      : surface;

    return resolved==='player'
      ? S.playerLabelMode
      : S.adminLabelMode;
  }

  function labelKeyPcForSurface(surface='auto'){
    const resolved=surface==='auto'
      ? (document.body.classList.contains('player')?'player':'admin')
      : surface;

    return resolved==='player'
      ? mod12(S.playerKeyPc)
      : mod12(S.keyPc);
  }

  function intervalLabel(s,f,surface='auto'){
    const relative=mod12(pcAt(s,f)-labelKeyPcForSurface(surface));
    return INTERVAL_LABELS[relative];
  }

  function positionLabel(s,f,surface='auto'){
    const mode=labelModeForSurface(surface);

    if(mode==='blank') return '';
    if(mode==='letter') return noteName(s,f);
    return intervalLabel(s,f,surface);
  }

  function applyPitchLabel(el,s,f,surface='auto'){
    if(!el) return;

    const text=positionLabel(s,f,surface);
    el.textContent=text;
    el.classList.toggle('longLabel',text.length>1);
    el.dataset.pitchString=String(s);
    el.dataset.pitchFret=String(f);
    el.dataset.pitchSurface=surface;
  }

  function refreshVisiblePitchLabels(surface='auto'){
    const resolved=surface==='auto'
      ? (document.body.classList.contains('player')?'player':'admin')
      : surface;

    document.querySelectorAll('.frameworkMark,.fingerMark').forEach(el=>{
      if(
        el.classList.contains('bendRing') &&
        !el.classList.contains('preBendPitchRing')
      ) return;

      const sNum=Number(el.dataset.pitchString);
      const fNum=Number(el.dataset.pitchFret);
      if(!Number.isInteger(sNum) || !Number.isFinite(fNum)) return;

      applyPitchLabel(el,sNum,fNum,resolved);
    });

    if(
      fingerAssignMark.style.display!=='none' &&
      fingerAssignMark.dataset.pitchString!==undefined &&
      fingerAssignMark.dataset.pitchFret!==undefined
    ){
      applyPitchLabel(
        fingerAssignMark,
        Number(fingerAssignMark.dataset.pitchString),
        Number(fingerAssignMark.dataset.pitchFret),
        'admin'
      );
    }
  }

  function labelModeTitle(mode){
    if(mode==='letter') return 'Letter';
    if(mode==='blank') return 'Blank';
    return 'Interval';
  }

  function updateLabelButtons(){
    adminLabelBtn.textContent='Labels: '+labelModeTitle(S.adminLabelMode);
    playerLabelBtn.textContent='Labels: '+labelModeTitle(S.playerLabelMode);
  }

  function cycleLabelMode(surface){
    const key=surface==='player'?'playerLabelMode':'adminLabelMode';
    const current=LABEL_MODE_ORDER.indexOf(S[key]);
    S[key]=LABEL_MODE_ORDER[(current+1)%LABEL_MODE_ORDER.length];

    updateLabelButtons();
    refreshVisiblePitchLabels(surface);
  }

  function shellPoint(s,f){
    const x=stringXs()[s];
    return f===0?{x,y:32}:{x,y:56+yForFret(f)};
  }


  function clampFingerBase(fret,finger){
    const raw=fret-finger;
    return Math.max(1,Math.min(TOTAL_FRETS-3,raw));
  }

  function cloneFingerPose(p){
    return {
      held:new Map([...p.held.entries()].map(([i,pos])=>[i,clonePos(pos)])),
      baseFret:p.baseFret,
      activeString:p.activeString,
      bendFinger:p.bendFinger,
      bendAmount:p.bendAmount
    };
  }

  function fingerRectThickness(){
    return Math.max(14,Math.abs(yForFret(6)-yForFret(5))*.92);
  }

  function chordAssignmentsForFinger(assignments,finger){
    return assignments
      .filter(n=>n.f>0 && fingerIndex(n.finger)===finger)
      .sort((a,b)=>a.f-b.f || a.s-b.s);
  }

  function chordBarreBaseReleaseForSpan(span){
    const releaseBySpan={2:.20,3:.40,4:.62,5:.85,6:1};
    return releaseBySpan[Math.max(2,Math.min(6,span))] ?? 0;
  }

  function chordBarreInfo(assignments,finger){
    const assigned=chordAssignmentsForFinger(assignments,finger);
    if(assigned.length<2) return null;
    if(!assigned.every(n=>n.f===assigned[0].f)) return null;

    const pts=assigned
      .map(note=>({note,p:shellPoint(note.s,note.f)}))
      .sort((a,b)=>a.p.x-b.p.x);

    const strings=assigned.map(n=>n.s);
    const span=Math.max(...strings)-Math.min(...strings)+1;
    const release=chordBarreBaseReleaseForSpan(span);

    return {
      finger,
      count:assigned.length,
      span,
      fret:assigned[0].f,
      release,
      full:span===6,
      farNote:pts[0].note,
      nearNote:pts[pts.length-1].note,
      x1:pts[0].p.x,
      x2:pts[pts.length-1].p.x,
      y:pts[0].p.y
    };
  }

  function chordDefaultBaseFret(assignments){
    const fretted=assignments.filter(n=>n.f>0 && validFingerLetter(n.finger));
    if(!fretted.length) return 5;

    if(fretted.length===1){
      return clampFingerBase(fretted[0].f,fingerIndex(fretted[0].finger));
    }

    const avg=fretted.reduce((sum,n)=>sum+n.f,0)/fretted.length;
    return Math.max(1,Math.min(TOTAL_FRETS-3,Math.round(avg-1.5)));
  }

  function chordSharedYOffset(assignments,baseFret){
    const engaged=[0,1,2,3]
      .filter(i=>chordAssignmentsForFinger(assignments,i).length>0);

    if(engaged.length<2) return 0;

    let maxAllowed=Infinity;

    for(const finger of engaged){
      const fa=chordAssignmentsForFinger(assignments,finger);
      const barre=chordBarreInfo(assignments,finger);

      // Successful prototype rule: full 6-string barre does not constrain
      // the common base row.
      if(barre && barre.full) continue;

      const focus=barre ? barre.nearNote : fa[0];
      const notePoint=shellPoint(focus.s,focus.f);
      const laneFret=Math.max(1,Math.min(TOTAL_FRETS,baseFret+finger));
      const rawBaseY=56+yForFret(laneFret);

      const release=barre ? barre.release : 0;
      const requiredDrop=MIN_DOWNWARD_DROP*(1-release);

      maxAllowed=Math.min(
        maxAllowed,
        notePoint.y-requiredDrop-rawBaseY
      );
    }

    return Number.isFinite(maxAllowed) ? Math.min(0,maxAllowed) : 0;
  }

  /*
    Validated hand-geometry engine from Hand Geometry Engine Prototype 0.1.

    Input:
      [{s,f,finger}, ...]

    Open strings use no finger and do not generate a physical finger.
    Same-fret multiple assignments to one finger generate a barre.
  */
  function computeChordHandLayout(inputNotes){
    const assignments=(inputNotes || [])
      .filter(n=>
        n &&
        Number.isInteger(n.s) && n.s>=0 && n.s<6 &&
        Number.isFinite(n.f) && n.f>=0 && n.f<=TOTAL_FRETS &&
        (n.f===0 || validFingerLetter(n.finger))
      )
      .map(n=>({
        s:n.s,
        f:n.f,
        finger:n.f===0?null:fingerIndex(n.finger)
      }));

    const baseFret=chordDefaultBaseFret(assignments);
    const sharedYOffset=chordSharedYOffset(assignments,baseFret);
    const thickness=fingerRectThickness();
    const fixedBaseX=bd.clientWidth + REST_CIRCLE_GAP + thickness;

    const fingers=[];
    const barres=[];

    for(let finger=0;finger<4;finger++){
      const fa=chordAssignmentsForFinger(assignments,finger);
      const laneFret=Math.max(1,Math.min(TOTAL_FRETS,baseFret+finger));
      const rawBaseY=56+yForFret(laneFret)+sharedYOffset;

      if(!fa.length){
        const base={x:fixedBaseX,y:rawBaseY};
        fingers.push({o:base,e:{...base},on:false});
        continue;
      }

      const barre=chordBarreInfo(assignments,finger);
      const focus=barre ? barre.farNote : fa[0];
      const tip=shellPoint(focus.s,focus.f);

      let baseY=rawBaseY;

      if(barre){
        baseY=
          rawBaseY*(1-barre.release) +
          tip.y*barre.release;

        barres.push({
          finger,
          count:barre.count,
          span:barre.span,
          fret:barre.fret,
          release:barre.release,
          full:barre.full,
          x1:barre.x1,
          x2:barre.x2,
          y:barre.y
        });
      }

      fingers.push({
        o:{x:fixedBaseX,y:baseY},
        e:tip,
        on:true
      });
    }

    return {assignments,baseFret,sharedYOffset,fingers,barres};
  }

  function clearChordBarres(){
    shell.querySelectorAll('.chordBarreLine').forEach(el=>el.remove());

    /*
      Do NOT clear chordFingerHitGeometry here. drawChordAssignmentHand()
      records the four visible finger segments and then calls drawChordBarres().
      Clearing the hit map from this visual cleanup routine made every chord
      finger button unresponsive. The hit map is cleared only when the
      fingering overlay/mode is actually left.
    */
  }

  function drawChordBarres(layout){
    clearChordBarres();
    for(const b of layout.barres){
      const line=document.createElement('div');
      line.className='chordBarreLine';
      line.style.left=b.x1+'px';
      line.style.top=b.y+'px';
      line.style.width=Math.max(0,b.x2-b.x1)+'px';
      shell.appendChild(line);
    }
  }

  function setChordFingerRect(el,g,instant=false){
    const thickness=fingerRectThickness();
    const dx=g.e.x-g.o.x;
    const dy=g.e.y-g.o.y;

    /*
      One renderer for EVERY finger state in the app.

      The rectangle is always anchored at the physical finger base on the
      right. Ordinary single-note geometry may supply a long "rest" segment
      even when g.on is false; chord geometry supplies e===o for an inactive
      finger. Using the actual segment length in both cases preserves those
      intended shapes without changing coordinate systems.
    */
    const length=Math.max(thickness,Math.hypot(dx,dy));

    /*
      The finger points mostly left. A raw vector angle therefore lives near
      +180/-180 degrees. Expressing the rectangle from its RIGHT-HAND base
      means 180 degrees is the neutral local direction, so subtract 180 and
      normalize. The visible rotation now stays near 0 degrees and never
      crosses the +/-180 discontinuity that caused the flipping seen in the
      screen recording.
    */
    let rotation=Math.atan2(dy,dx)*180/Math.PI - 180;

    while(rotation>180) rotation-=360;
    while(rotation<-180) rotation+=360;

    if(instant) el.style.transition='none';

    el.style.transformOrigin='100% 50%';
    el.style.left=(g.o.x-length)+'px';
    el.style.top=(g.o.y-thickness/2)+'px';
    el.style.width=length+'px';
    el.style.height=thickness+'px';
    el.style.transform=`rotate(${rotation}deg)`;
    el.classList.toggle('engaged',g.on);

    if(instant){
      el.getBoundingClientRect();
      el.style.transition='';
    }
  }

  function drawChordHand(notes,instant=false){
    const layout=computeChordHandLayout(notes);
    layout.fingers.forEach((g,i)=>setChordFingerRect(fingerRects[i],g,instant));
    drawChordBarres(layout);
    return layout;
  }

  function drawPlayerChordHand(notes,pose,instant=false){
    const layout=computeChordHandLayout(notes);
    const thickness=fingerRectThickness();
    const originX=bd.clientWidth+thickness;
    const restX=playbackRestX(pose);

    layout.fingers.forEach((g,i)=>{
      if(g.on){
        // Preserve the validated chord geometry for fingers actually playing.
        setChordFingerRect(fingerRects[i],g,instant);
        return;
      }

      /*
        Playback-only rule:
        an unused finger should retract just like it does during ordinary
        single-note playback. Do NOT collapse it into the tiny far-right
        capsule used by computeChordHandLayout() for inactive chord fingers.
      */
      const laneFret=Math.max(
        1,
        Math.min(TOTAL_FRETS,(pose && pose.baseFret ? pose.baseFret : layout.baseFret)+i)
      );
      const laneY=56+yForFret(laneFret);

      setChordFingerRect(
        fingerRects[i],
        {
          o:{x:originX,y:laneY},
          e:{x:restX,y:laneY},
          on:false
        },
        instant
      );
    });

    drawChordBarres(layout);
    return layout;
  }

  function chordNotesWithoutAssignments(notes){
    return (notes || []).map(note=>({
      s:note.s,
      f:note.f
    }));
  }

  function drawNeutralChordAssignmentHand(notes,instant=false){
    return drawChordAssignmentHand(
      chordNotesWithoutAssignments(notes),
      instant
    );
  }

  function drawChordAssignmentHand(notes,instant=false){
    const layout=computeChordHandLayout(notes);
    const extensionLength=Math.max(54,fingerRectThickness()*3.4);
    chordFingerHitGeometry=[];

    layout.fingers.forEach((g,i)=>{
      let visibleGeometry=g;

      if(!g.on){
        /*
          During chord fingering assignment, an unassigned finger should
          still appear as a full finger rather than a short resting capsule.
        */
        visibleGeometry={
          o:{...g.o},
          e:{
            x:g.o.x-extensionLength,
            y:g.o.y
          },
          on:true
        };
      }

      setChordFingerRect(fingerRects[i],visibleGeometry,instant);

      // Record the exact visible centerline for this physical finger.
      chordFingerHitGeometry.push({
        finger:i,
        o:{...visibleGeometry.o},
        e:{...visibleGeometry.e}
      });
    });

    drawChordBarres(layout);
    return layout;
  }

  function pointToSegmentDistance(px,py,a,b){
    const vx=b.x-a.x;
    const vy=b.y-a.y;
    const wx=px-a.x;
    const wy=py-a.y;
    const vv=vx*vx+vy*vy;

    if(vv<=0.0001){
      return Math.hypot(px-a.x,py-a.y);
    }

    const t=Math.max(0,Math.min(1,(wx*vx+wy*vy)/vv));
    const qx=a.x+t*vx;
    const qy=a.y+t*vy;
    return Math.hypot(px-qx,py-qy);
  }

  function chordFingerFromTap(clientX,clientY){
    if(!chordFingerHitGeometry.length) return -1;

    // computeChordHandLayout() produces shell-relative points.
    const rect=shell.getBoundingClientRect();
    const px=clientX-rect.left;
    const py=clientY-rect.top;

    const ranked=chordFingerHitGeometry
      .map(g=>({
        finger:g.finger,
        distance:pointToSegmentDistance(px,py,g.o,g.e)
      }))
      .sort((a,b)=>a.distance-b.distance);

    if(!ranked.length) return -1;

    // The visible capsule is approximately fingerRectThickness() wide.
    // Add a small touch allowance for iPhone without allowing taps from
    // neighboring lanes to steal one another.
    const maxDistance=fingerRectThickness()*.85+10;
    return ranked[0].distance<=maxDistance ? ranked[0].finger : -1;
  }

  function chooseChordFingerFromPointer(e){
    if(
      !S.fingeringAssign.active ||
      !document.body.classList.contains('chordChoosingFinger')
    ) return false;

    const finger=chordFingerFromTap(e.clientX,e.clientY);
    if(finger<0) return false;

    chooseAssignedFinger(FINGER_LETTERS[finger]);
    return true;
  }

  function chordApproxFingerPose(notes){
    const layout=computeChordHandLayout(notes);
    const p=blankFingerPose();
    p.baseFret=layout.baseFret;

    const fretted=(notes || []).filter(n=>n.f>0 && validFingerLetter(n.finger));
    if(fretted.length){
      p.activeString=fretted[fretted.length-1].s;
    }

    for(let finger=0;finger<4;finger++){
      const assigned=chordAssignmentsForFinger(
        (notes || []).map(n=>({...n,finger:n.f===0?null:fingerIndex(n.finger)})),
        finger
      );
      if(!assigned.length) continue;

      const barre=chordBarreInfo(
        (notes || []).map(n=>({...n,finger:n.f===0?null:fingerIndex(n.finger)})),
        finger
      );
      const focus=barre ? barre.farNote : assigned[0];
      p.held.set(finger,{s:focus.s,f:focus.f});
    }

    return p;
  }

  function fingerGeometry(pose){
    const X=stringXs();
    const thickness=fingerRectThickness();
    const originX=bd.clientWidth+thickness;

    let restX=X[3];
    if(pose.activeString!==null){
      restX=pose.activeString===5 ? bd.clientWidth : X[pose.activeString+1];
    }

    const g=[];
    for(let i=0;i<4;i++){
      const laneFret=Math.max(1,Math.min(TOTAL_FRETS,pose.baseFret+i));
      const laneY=56+yForFret(laneFret);
      const origin={x:originX,y:laneY};
      let end={x:restX,y:laneY};
      let on=false;

      const fp=pose.held.get(i);
      if(fp){
        end=shellPoint(fp.s,fp.f);

        if(pose.bendFinger===i && pose.bendAmount>0){
          const nextString=Math.min(5,fp.s+1);
          const targetX=X[nextString];
          end={
            x:end.x+(targetX-end.x)*pose.bendAmount,
            y:end.y
          };
        }
        on=true;
      }

      g.push({o:origin,e:end,on});
    }
    return g;
  }

  function setFingerRect(el,g,instant=false){
    /*
      Individual notes, hammer-ons, pull-offs, slides and bends now use the
      exact same base-anchored representation as chords. Their hand geometry
      is unchanged; only the DOM rendering coordinate system is unified.
    */
    setChordFingerRect(el,g,instant);
  }

  const FINGER_RENDERER_MODE='base-anchored-unified';

  function drawFingerPose(pose,instant=false){
    fingerGeometry(pose).forEach((g,i)=>setFingerRect(fingerRects[i],g,instant));
  }

  function drawFingerPoseTimed(pose,durationMs){
    const d=Math.max(0,durationMs);

    fingerRects.forEach(el=>{
      el.style.transition=
        `left ${d}ms cubic-bezier(.22,.72,.24,1),`+
        `top ${d}ms cubic-bezier(.22,.72,.24,1),`+
        `width ${d}ms cubic-bezier(.22,.72,.24,1),`+
        `height ${d}ms cubic-bezier(.22,.72,.24,1),`+
        `transform ${d}ms cubic-bezier(.22,.72,.24,1),`+
        `opacity .18s ease,box-shadow .18s ease,border-color .18s ease`;
    });

    drawFingerPose(pose,false);

    setTimeout(()=>{
      fingerRects.forEach(el=>{
        el.style.transition='';
      });
    },d+30);
  }

  function restingPoseAtSameHandPosition(pose){
    const p=cloneFingerPose(pose || blankFingerPose());
    p.held.clear();
    p.bendFinger=null;
    p.bendAmount=0;
    // Deliberately preserve baseFret and activeString. This is the physical
    // hand location reached by the most recent finger assignment/movement.
    return p;
  }

  function hasEstablishedHandPosition(pose){
    return !!(
      pose &&
      (pose.activeString!==null || pose.held.size>0)
    );
  }

  /*
    SHARED HAND-POSITION ENGINE

    This is the single source of truth for where the four fingers/hand end up
    after an authored event. Both Admin assignment and Player playback use it.

    Important: this routine calculates PHYSICAL HAND STATE only. Admin and
    Player intentionally keep separate pink-marker/UI wrappers so their
    display mechanics cannot interfere with one another.
  */
  function nextFingerPoseForEvent(currentPose,e){
    const p=cloneFingerPose(currentPose || blankFingerPose());

    if(e.type==='fingerOff'){
      // Release the sounding/fretted note, but leave the hand exactly where
      // the last physical assignment put it. Open strings that follow should
      // not send the hand back to the default fret-5 location.
      return restingPoseAtSameHandPosition(p);
    }

    if(e.type==='chord'){
      return chordApproxFingerPose(e.notes || []);
    }

    if(e.type==='fingerOn'){
      // Open string: sounding phantom only. Leave the fretting hand where the
      // surrounding sequence has placed it.
      if(e.f===0){
        return p;
      }

      const finger=fingerIndex(e.finger);
      if(finger>=0){
        p.held.clear();
        p.held.set(finger,{s:e.s,f:e.f});
        p.baseFret=clampFingerBase(e.f,finger);
        p.activeString=e.s;
        p.bendFinger=null;
        p.bendAmount=0;
      }
      return p;
    }

    if(e.type!=='move'){
      return p;
    }

    if(isChordMoveEvent(e)){
      const fromFinger=fingerIndex(e.fromFinger);
      const toFinger=e.to && e.to.f===0
        ? -1
        : fingerIndex(e.toFinger ?? e.finger);

      if(e.movement===MOVEMENT_TYPE.HAMMER){
        if(e.from.f>0 && fromFinger>=0) p.held.set(fromFinger,clonePos(e.from));
        if(e.to.f>0 && toFinger>=0) p.held.set(toFinger,clonePos(e.to));
        if(e.to.f>0 && toFinger>=0) p.baseFret=clampFingerBase(e.to.f,toFinger);
        p.activeString=e.to.s;
        p.bendFinger=null;
        p.bendAmount=0;
        return p;
      }

      if(e.movement===MOVEMENT_TYPE.PULL){
        if(fromFinger>=0) p.held.delete(fromFinger);
        if(e.to.f>0 && toFinger>=0) p.held.set(toFinger,clonePos(e.to));
        if(e.to.f>0 && toFinger>=0) p.baseFret=clampFingerBase(e.to.f,toFinger);
        p.activeString=e.to.s;
        p.bendFinger=null;
        p.bendAmount=0;
        return p;
      }

      if(e.movement===MOVEMENT_TYPE.SLIDE){
        const finger=fingerIndex(e.finger ?? e.toFinger ?? e.fromFinger);
        if(finger>=0){
          p.held.set(finger,clonePos(e.to));
          if(e.to.f>0) p.baseFret=clampFingerBase(e.to.f,finger);
        }
        p.activeString=e.to.s;
        p.bendFinger=null;
        p.bendAmount=0;
        return p;
      }

      if(e.movement===MOVEMENT_TYPE.BEND){
        const finger=fingerIndex(e.finger ?? e.fromFinger ?? e.toFinger);
        const home=e.bendHome || e.from;
        if(finger>=0 && home) p.held.set(finger,clonePos(home));
        if(finger>=0 && home && home.f>0) p.baseFret=clampFingerBase(home.f,finger);
        p.activeString=home ? home.s : e.to.s;
        p.bendFinger=finger>=0 ? finger : null;
        p.bendAmount=e.bendPhase===BEND_PHASE.RELEASE
          ? 0
          : Math.max(0,Math.min(1,Math.abs(e.to.f-e.from.f)/2));
        return p;
      }
    }

    if(e.movement==='hammer-on'){
      const fromFinger=fingerIndex(e.fromFinger);
      const toFinger=fingerIndex(e.toFinger ?? e.finger);

      p.held.clear();
      if(e.from.f>0 && fromFinger>=0) p.held.set(fromFinger,clonePos(e.from));
      if(e.to.f>0 && toFinger>=0) p.held.set(toFinger,clonePos(e.to));

      if(e.to.f>0 && toFinger>=0) p.baseFret=clampFingerBase(e.to.f,toFinger);
      p.activeString=e.to.s;
      p.bendFinger=null;
      p.bendAmount=0;
      return p;
    }

    if(e.movement==='pull-off'){
      const toFinger=e.to && e.to.f===0
        ? -1
        : fingerIndex(e.toFinger ?? e.finger);

      p.held.clear();
      if(e.to.f>0 && toFinger>=0) p.held.set(toFinger,clonePos(e.to));

      if(e.to.f>0 && toFinger>=0) p.baseFret=clampFingerBase(e.to.f,toFinger);
      p.activeString=e.to.s;
      p.bendFinger=null;
      p.bendAmount=0;
      return p;
    }

    if(e.movement==='slide'){
      const finger=fingerIndex(e.finger ?? e.toFinger);

      p.held.clear();
      if(e.to.f>0 && finger>=0) p.held.set(finger,clonePos(e.to));

      if(e.to.f>0 && finger>=0) p.baseFret=clampFingerBase(e.to.f,finger);
      p.activeString=e.to.s;
      p.bendFinger=null;
      p.bendAmount=0;
      return p;
    }

    if(e.movement==='bend'){
      const finger=fingerIndex(e.finger ?? e.toFinger);
      const home=e.bendHome || ((e.bendPhase==='release' || e.bendPhase==='pre-release')?e.to:e.from);

      p.held.clear();
      if(finger>=0 && home) p.held.set(finger,clonePos(home));

      if(finger>=0 && home) p.baseFret=clampFingerBase(home.f,finger);
      p.activeString=home?home.s:e.to.s;
      p.bendFinger=finger>=0?finger:null;

      if(e.bendPhase==='release' || e.bendPhase==='pre-release'){
        p.bendAmount=0;
      }else{
        const semitones=Math.abs(e.to.f-e.from.f);
        p.bendAmount=Math.max(0,Math.min(1,semitones/2));
      }
      return p;
    }

    return p;
  }

  function setFingerPoseForEvent(e){
    S.fingerPose=nextFingerPoseForEvent(S.fingerPose,e);
    return S.fingerPose;
  }

  function pullOffPreparedPose(e,finalPose){
    // A real pull-off requires the receiving/lower finger to already be
    // planted before the releasing finger leaves the string.
    const p=cloneFingerPose(finalPose);

    const fromFinger=fingerIndex(e.fromFinger);
    const toFinger=e.to && e.to.f===0
      ? -1
      : fingerIndex(e.toFinger ?? e.finger);

    if(e.to.f>0 && toFinger>=0){
      p.held.set(toFinger,clonePos(e.to));
    }
    if(fromFinger>=0){
      p.held.set(fromFinger,clonePos(e.from));
    }

    p.activeString=e.to.s;
    p.bendFinger=null;
    p.bendAmount=0;
    return p;
  }

  function currentPlaybackDot(){
    return document.querySelector('.fingerMark:not(.bendRing)');
  }

  function currentPlaybackBendRing(){
    return document.querySelector('.fingerMark.bendRing');
  }

  function playbackDotAt(pos,{bendRing=false}={}){
    if(!pos) return null;
    return [...document.querySelectorAll('.fingerMark')].find(el=>{
      if(bendRing!==el.classList.contains('bendRing')) return false;
      return Number(el.dataset.pitchString)===pos.s &&
        Number(el.dataset.pitchFret)===pos.f;
    }) || null;
  }

  async function chordConnectedMarkerMove(e,duration,run,cue=null){
    let dot=playbackDotAt(e.from);

    if(!dot){
      dot=makeMark(
        fingerMarkClass(e.from),
        e.from.s,
        e.from.f,
        positionLabel(e.from.s,e.from.f,'player')
      );
    }

    moveDotTo(dot,e.to,duration);

    if(typeof cue==='function') cue();

    await sleep(duration);
    if(run!==S.runId) return null;

    dot.classList.toggle('openPhantom',e.to.f===0);
    applyPitchLabel(dot,e.to.s,e.to.f,'player');
    return dot;
  }

  function playChordMovementStationaryVoices(e){
    if(!isChordMoveEvent(e)) return;

    const duration=Math.max(.18,eventDurationMs(e)/1000*.92);
    const movingString=e.to ? e.to.s : (e.from ? e.from.s : null);

    for(const note of e.chordAfter || []){
      // The changed voice gets its own articulation-specific sound below.
      // Every other resulting pink note is re-triggered as part of the
      // second chord state.
      if(movingString!==null && note.s===movingString) continue;
      playStringSample(note.s,note.f,.24,duration);
    }
  }

  async function performChordMovementPlayback(
    e,
    run,
    {withHand=false,targetPose=null}={}
  ){
    const started=performance.now();

    if(e.movement===MOVEMENT_TYPE.HAMMER){
      if(withHand && targetPose) drawFingerPose(targetPose,false);
      await chordConnectedMarkerMove(
        e,
        scaledPlaybackMs(PLAYBACK_TIMING.CONNECTED_MARKER_MS,e),
        run,
        ()=>{
          playChordMovementStationaryVoices(e);
          playHammerOnArticulation(e);
        }
      );
    }else if(e.movement===MOVEMENT_TYPE.PULL){
      if(withHand && targetPose){
        const prepared=pullOffPreparedPose(e,targetPose);
        drawFingerPose(prepared,false);
        await sleep(scaledPlaybackMs(PLAYBACK_TIMING.PULL_PREPARE_MS,e));
        if(run!==S.runId) return;
      }

      playPullOffRelease(e);

      if(withHand && targetPose) drawFingerPose(targetPose,false);

      await sleep(scaledPlaybackMs(PLAYBACK_TIMING.PULL_RELEASE_CUE_MS,e,12));
      if(run!==S.runId) return;

      await chordConnectedMarkerMove(
        e,
        scaledPlaybackMs(PLAYBACK_TIMING.CONNECTED_MARKER_MS,e),
        run,
        ()=>{
          playChordMovementStationaryVoices(e);
          playPullOffResult(e);
        }
      );
    }else if(e.movement===MOVEMENT_TYPE.SLIDE){
      if(withHand && targetPose) drawFingerPose(targetPose,false);
      playChordMovementStationaryVoices(e);
      const audioPromise=playSlideArticulation(e,run);
      await chordConnectedMarkerMove(
        e,
        scaledPlaybackMs(PLAYBACK_TIMING.SLIDE_MS,e),
        run
      );
      await audioPromise;
    }else if(e.movement===MOVEMENT_TYPE.BEND){
      const home=e.bendHome || e.from;
      let dot=playbackDotAt(
        e.bendPhase===BEND_PHASE.RELEASE ? e.from : home
      ) || playbackDotAt(home);

      if(!dot){
        dot=makeMark(
          fingerMarkClass(home),
          home.s,
          home.f,
          positionLabel(home.s,home.f,'player')
        );
      }

      const X=stringXs();
      const homeX=X[home.s];
      const nextX=X[Math.min(5,home.s+1)];
      const duration=scaledPlaybackMs(PLAYBACK_TIMING.BEND_MS,e);

      if(e.bendPhase===BEND_PHASE.RELEASE){
        playChordMovementStationaryVoices(e);
        releaseBendArticulation(e);

        const ring=playbackDotAt(e.from,{bendRing:true});
        setMarkTransition(dot,duration);
        dot.style.left=homeX+'px';
        dot.style.top=yForFret(home.f)+'px';

        if(ring){
          setMarkTransition(ring,duration);
          ring.style.left=homeX+'px';
          ring.style.top=yForFret(home.f)+'px';
          ring.style.opacity='.18';
        }

        if(withHand && targetPose) drawFingerPose(targetPose,false);
        await sleep(duration);
        if(ring) ring.remove();

        dot.dataset.pitchString=String(e.to.s);
        dot.dataset.pitchFret=String(e.to.f);
        applyPitchLabel(dot,e.to.s,e.to.f,'player');
      }else{
        playChordMovementStationaryVoices(e);
        startBendArticulation(e);

        const semitones=Math.abs(e.to.f-e.from.f);
        const amount=Math.max(0,Math.min(1,semitones/2));
        const physicalX=homeX+(nextX-homeX)*amount;

        setMarkTransition(dot,duration);
        dot.style.left=physicalX+'px';
        dot.style.top=yForFret(home.f)+'px';

        let ring=playbackDotAt(e.to,{bendRing:true});
        if(!ring){
          ring=makeMark(
            'fingerMark bendRing',
            e.to.s,
            e.to.f,
            positionLabel(e.to.s,e.to.f,'player')
          );
        }

        if(withHand && targetPose) drawFingerPose(targetPose,false);
        await sleep(duration);
      }
    }

    const remaining=eventDurationMs(e)-(performance.now()-started);
    if(remaining>0) await sleep(remaining);
  }

  function setMarkTransition(el,duration){
    el.style.transition=
      `left ${duration}ms cubic-bezier(.22,.72,.24,1),`+
      `top ${duration}ms cubic-bezier(.22,.72,.24,1),`+
      `opacity 90ms ease,transform 90ms ease`;
  }

  function moveDotTo(el,pos,duration){
    if(!el) return;

    const targetHost=pos.f===0?orow:bd;
    if(el.parentElement!==targetHost){
      targetHost.appendChild(el);
    }

    setMarkTransition(el,duration);
    el.style.left=stringXs()[pos.s]+'px';
    el.style.top=(pos.f===0?32:yForFret(pos.f))+'px';
    el.dataset.pitchString=String(pos.s);
    el.dataset.pitchFret=String(pos.f);
  }

  async function discretePluckMarker(e,run){
    const old=currentPlaybackDot();
    if(old){
      old.style.transition='opacity 65ms ease,transform 65ms ease';
      old.style.opacity='0';
      old.style.transform='translate(-50%,-50%) scale(.72)';
      await sleep(PLAYBACK_TIMING.DISCRETE_FADE_MS);
      if(run!==S.runId) return null;
      old.remove();
    }

    const d=makeMark(fingerMarkClass(e),e.s,e.f,positionLabel(e.s,e.f,'player'));
    d.style.opacity='0';
    d.style.transform='translate(-50%,-50%) scale(.72)';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      d.style.transition='opacity 80ms ease,transform 80ms ease';
      d.style.opacity='1';
      d.style.transform='translate(-50%,-50%) scale(1)';
    }));
    await sleep(PLAYBACK_TIMING.DISCRETE_APPEAR_MS);
    return d;
  }

  async function connectedMarkerMove(to,duration,run){
    let d=currentPlaybackDot();
    if(!d){
      d=makeMark(fingerMarkClass(to),to.s,to.f,positionLabel(to.s,to.f,'player'));
      return d;
    }
    moveDotTo(d,to,duration);
    await sleep(duration);
    if(run!==S.runId) return null;
    d.classList.toggle('openPhantom',to.f===0);
    applyPitchLabel(d,to.s,to.f,'player');
    return d;
  }

  async function connectedMarkerMoveWithCue(
    to,
    duration,
    run,
    cue,
    leadMs=duration
  ){
    let d=currentPlaybackDot();

    if(!d){
      d=makeMark(fingerMarkClass(to),to.s,to.f,positionLabel(to.s,to.f,'player'));
      if(typeof cue==='function') cue();
      return d;
    }

    moveDotTo(d,to,duration);

    const lead=Math.max(0,Math.min(duration,leadMs));
    const beforeCue=Math.max(0,duration-lead);

    if(beforeCue>0) await sleep(beforeCue);
    if(run!==S.runId) return null;

    if(typeof cue==='function') cue();

    if(lead>0) await sleep(lead);
    if(run!==S.runId) return null;

    d.classList.toggle('openPhantom',to.f===0);
    applyPitchLabel(d,to.s,to.f,'player');
    return d;
  }

  function preBendAmount(e){
    if(!e || !e.from || !e.bendHome) return 0;
    const semitones=Math.abs(e.from.f-e.bendHome.f);
    return Math.max(0,Math.min(1,semitones/2));
  }

  function preBentPoseFromFinal(finalPose,e){
    const p=cloneFingerPose(finalPose);
    const fi=fingerIndex(e.finger ?? e.toFinger);
    p.bendFinger=fi>=0?fi:null;
    p.bendAmount=preBendAmount(e);
    return p;
  }

  async function preBendReleaseMarkerMove(
    e,
    duration=eventDurationMs(e),
    run
  ){
    document.querySelectorAll('.fingerMark').forEach(el=>el.remove());

    const home=e.bendHome || e.to;
    const pitch=e.from;
    if(!home || !pitch) return;

    const total=Math.max(1,duration);
    const holdMs=Math.round(total*PLAYBACK_TIMING.PRE_BEND_HOLD_RATIO);
    const releaseMs=total-holdMs;

    const X=stringXs();
    const homeX=X[home.s];
    const nextX=X[Math.min(5,home.s+1)];
    const amount=preBendAmount(e);
    const bentX=homeX+(nextX-homeX)*amount;

    // Physical fretting position: solid dot, already displaced sideways
    // because the string is pre-bent before it is plucked.
    const dot=makeMark(
      fingerMarkClass(home),
      home.s,
      home.f,
      positionLabel(home.s,home.f,'player')
    );
    dot.style.left=bentX+'px';

    // Sounding pitch: phantom ring, because there is no finger at this fret.
    const ring=makeMark(
      'fingerMark bendRing preBendPitchRing',
      pitch.s,
      pitch.f,
      positionLabel(pitch.s,pitch.f,'player')
    );

    dot.getBoundingClientRect();
    ring.getBoundingClientRect();

    /*
      Stage 1 — HOLD.
      For the first third of the one-second event, the phantom ring stays fully
      visible at the pre-bent pitch and the audio stays at that pitch.
    */
    startPreBendReleaseArticulation(e,holdMs,releaseMs);

    await sleep(holdMs);
    if(run!==S.runId) return;

    /*
      Stage 2 — RELEASE.
      Over the remaining two thirds, the physical string/finger relaxes and the
      phantom sounding pitch travels down to the actual fretted position.
    */
    setMarkTransition(dot,releaseMs);
    dot.style.left=homeX+'px';
    dot.style.top=yForFret(home.f)+'px';

    setMarkTransition(ring,releaseMs);
    ring.style.left=homeX+'px';
    ring.style.top=yForFret(home.f)+'px';
    ring.style.opacity='.18';

    await sleep(releaseMs);
    if(run!==S.runId) return;

    ring.remove();
    dot.style.opacity='1';
    applyPitchLabel(dot,home.s,home.f,'player');
  }

  async function bendMarkerMove(e,duration,run){
    let dot=currentPlaybackDot();
    if(!dot){
      const home=e.bendHome || e.from;
      dot=makeMark(fingerMarkClass(home),home.s,home.f,positionLabel(home.s,home.f,'player'));
    }

    const X=stringXs();
    const home=e.bendHome || ((e.bendPhase==='release' || e.bendPhase==='pre-release')?e.to:e.from);
    const homeX=X[home.s];
    const nextX=X[Math.min(5,home.s+1)];

    if(e.bendPhase==='release'){
      setMarkTransition(dot,duration);
      dot.style.left=homeX+'px';
      dot.style.top=yForFret(home.f)+'px';

      const ring=currentPlaybackBendRing();
      if(ring){
        setMarkTransition(ring,duration);
        ring.style.left=homeX+'px';
        ring.style.top=yForFret(home.f)+'px';
      }

      await sleep(duration);
      if(run!==S.runId) return;
      if(ring) ring.remove();
      applyPitchLabel(dot,home.s,home.f,'player');
      return;
    }

    const semitones=Math.abs(e.to.f-e.from.f);
    const amount=Math.max(0,Math.min(1,semitones/2));
    const physicalX=homeX+(nextX-homeX)*amount;

    setMarkTransition(dot,duration);
    dot.style.left=physicalX+'px';
    dot.style.top=yForFret(home.f)+'px';

    let ring=currentPlaybackBendRing();
    if(!ring){
      ring=makeMark('fingerMark bendRing',home.s,home.f,'');
      ring.getBoundingClientRect();
    }
    setMarkTransition(ring,duration);
    ring.style.left=X[e.to.s]+'px';
    ring.style.top=yForFret(e.to.f)+'px';

    await sleep(duration);
  }

  function fingerDemoEvents(){
    const ev=[];
    const aMinorPent=new Set([9,0,2,4,7]); // A C D E G
    for(let s=0;s<6;s++){
      for(let f=1;f<=TOTAL_FRETS;f++){
        if(aMinorPent.has(pcAt(s,f))) ev.push({type:'frameworkOn',s,f,play:true});
      }
    }

    ev.push(
      {type:'fingerOn',s:2,f:5,finger:0,articulation:'pluck',play:true},
      {
        type:'move',movement:'hammer-on',
        from:{s:2,f:5},to:{s:2,f:7},
        fromFinger:0,toFinger:2,play:true
      },
      {
        type:'move',movement:'pull-off',
        from:{s:2,f:7},to:{s:2,f:5},
        fromFinger:2,toFinger:0,play:true
      },
      {type:'fingerOn',s:1,f:7,finger:2,articulation:'pluck',play:true},
      {type:'fingerOn',s:2,f:5,finger:0,articulation:'pluck',play:true},
      {
        type:'move',movement:'slide',
        from:{s:2,f:5},to:{s:2,f:7},
        finger:0,fromFinger:0,toFinger:0,play:true
      },
      {
        type:'move',movement:'slide',
        from:{s:2,f:7},to:{s:2,f:5},
        finger:0,fromFinger:0,toFinger:0,play:true
      },
      {type:'fingerOn',s:3,f:5,finger:0,articulation:'pluck',play:true},
      {type:'fingerOn',s:3,f:7,finger:2,articulation:'pluck',play:true},
      {
        type:'move',movement:'bend',
        from:{s:3,f:7},to:{s:3,f:9},
        finger:2,fromFinger:2,toFinger:2,
        bendId:'demo-bend',bendPhase:'up',bendHome:{s:3,f:7},play:true
      },
      {
        type:'move',movement:'bend',
        from:{s:3,f:9},to:{s:3,f:7},
        finger:2,fromFinger:2,toFinger:2,
        bendId:'demo-bend',bendPhase:'release',bendHome:{s:3,f:7},play:true
      },
      {type:'fingerOn',s:4,f:5,finger:0,articulation:'pluck',play:true}
    );

    return ev;
  }

  function clampPlaybackBaseFret(base){
    return Math.max(1,Math.min(TOTAL_FRETS-3,base));
  }

  function playbackLaneErrors(pose,baseFret){
    const errors=[];

    for(const [finger,pos] of pose.held.entries()){
      if(
        !Number.isInteger(finger) ||
        finger<0 || finger>3 ||
        !pos ||
        !Number.isFinite(pos.f) ||
        pos.f<=0
      ) continue;

      const laneFret=baseFret+finger;
      errors.push({
        finger,
        fret:pos.f,
        laneFret,
        error:Math.abs(laneFret-pos.f)
      });
    }

    return errors;
  }

  function bestPlaybackBaseFret(previousPose,rawPose){
    const previousBase=clampPlaybackBaseFret(
      previousPose ? previousPose.baseFret : rawPose.baseFret
    );
    const rawBase=clampPlaybackBaseFret(rawPose.baseFret);

    const held=[...rawPose.held.entries()]
      .filter(([finger,pos])=>
        Number.isInteger(finger) &&
        finger>=0 && finger<=3 &&
        pos &&
        Number.isFinite(pos.f) &&
        pos.f>0
      );

    // Open strings / releases do not move the hand.
    if(!held.length) return previousBase;

    /*
      Preserve the current hand position when every engaged finger is no more
      than one fret away from its natural lane. This allows a realistic
      one-fret stretch without making the whole hand jump unnecessarily.
    */
    const currentErrors=playbackLaneErrors(rawPose,previousBase);
    if(
      currentErrors.length &&
      currentErrors.every(item=>item.error<=1)
    ){
      return previousBase;
    }

    /*
      Otherwise choose the four-fret hand base that best matches the authored
      finger assignments. Rank candidates by:
        1. smallest worst finger-lane error
        2. smallest total error
        3. smallest movement from the existing hand position
        4. closeness to the event engine's raw base
      This makes the WHOLE HAND move when an index/middle/ring/pinky assignment
      would otherwise create a long diagonal finger across the neck.
    */
    let best=null;

    for(let base=1;base<=TOTAL_FRETS-3;base++){
      const errors=playbackLaneErrors(rawPose,base);
      if(!errors.length) continue;

      const maxError=Math.max(...errors.map(x=>x.error));
      const totalError=errors.reduce((sum,x)=>sum+x.error,0);
      const moveDistance=Math.abs(base-previousBase);
      const rawDistance=Math.abs(base-rawBase);

      const score=[maxError,totalError,moveDistance,rawDistance];

      if(
        !best ||
        score[0]<best.score[0] ||
        (score[0]===best.score[0] && score[1]<best.score[1]) ||
        (score[0]===best.score[0] && score[1]===best.score[1] && score[2]<best.score[2]) ||
        (score[0]===best.score[0] && score[1]===best.score[1] && score[2]===best.score[2] && score[3]<best.score[3])
      ){
        best={base,score};
      }
    }

    return best ? clampPlaybackBaseFret(best.base) : rawBase;
  }

  function stablePlaybackBaseFret(previousPose,rawPose,event=null){
    if(!previousPose) return clampPlaybackBaseFret(rawPose.baseFret);

    /*
      Chords already have a validated shared hand position from the chord
      geometry engine. Do not override that with the single-note stabilization
      rule; doing so can distort barre/chord geometry.
    */
    if(event && event.type===EVENT_TYPE.CHORD){
      return clampPlaybackBaseFret(rawPose.baseFret);
    }

    return bestPlaybackBaseFret(previousPose,rawPose);
  }

  function stabilizePlaybackPose(previousPose,rawPose,event=null){
    const p=cloneFingerPose(rawPose);

    if(previousPose){
      p.baseFret=stablePlaybackBaseFret(previousPose,rawPose,event);

      /*
        activeString controls the horizontal resting endpoint of all fingers
        that are not currently pressing a note. Preserve it so unused fingers
        do not slide left/right between notes; vertical hand movement is now
        handled independently by the finger-aware base-fret engine above.
      */
      if(previousPose.activeString!==null){
        p.activeString=previousPose.activeString;
      }
    }

    return p;
  }

  const PLAYBACK_HAND_SHIFT_MS=135;
  const PLAYBACK_HAND_EXTEND_MS=155;

  function playbackBaseChanged(previousPose,targetPose){
    if(!previousPose || !targetPose) return false;
    return Math.abs(
      Number(targetPose.baseFret || 0) -
      Number(previousPose.baseFret || 0)
    )>=1;
  }

  function collectedPlaybackPose(targetPose){
    const p=cloneFingerPose(targetPose || blankFingerPose());
    p.held.clear();
    p.bendFinger=null;
    p.bendAmount=0;
    return p;
  }

  async function shiftPlaybackHandThenExtend(
    previousPose,
    targetPose,
    run,
    extendFn=null
  ){
    if(
      !previousPose ||
      !targetPose ||
      !playbackBaseChanged(previousPose,targetPose)
    ){
      if(typeof extendFn==='function') extendFn();
      else drawFingerPose(targetPose,false);
      return true;
    }

    /*
      Avoid the long diagonal interpolation that makes finger rectangles sweep
      through one another. First collect/retract all fingers at the NEW hand
      position, then extend the required finger(s).
    */
    const collected=collectedPlaybackPose(targetPose);

    // Move the compact hand vertically as one unit.
    drawFingerPoseTimed(collected,PLAYBACK_HAND_SHIFT_MS);
    await sleep(PLAYBACK_HAND_SHIFT_MS);
    if(run!==S.runId) return false;

    // Then extend into the actual note/chord geometry.
    if(typeof extendFn==='function'){
      extendFn();
    }else{
      drawFingerPoseTimed(targetPose,PLAYBACK_HAND_EXTEND_MS);
    }

    await sleep(PLAYBACK_HAND_EXTEND_MS);
    return run===S.runId;
  }

  function playbackChordPose(previousPose,notes){
    const raw=chordApproxFingerPose(notes || []);
    const p=stabilizePlaybackPose(
      previousPose,
      raw,
      {type:EVENT_TYPE.CHORD}
    );

    // chordApproxFingerPose already supplies the physical finger holdings.
    p.held=raw.held;
    p.bendFinger=null;
    p.bendAmount=0;
    return p;
  }

  function playbackRestX(pose){
    const X=stringXs();

    if(pose && pose.activeString!==null){
      return pose.activeString===5
        ? bd.clientWidth
        : X[pose.activeString+1];
    }

    return X[3];
  }

  function computeStablePlaybackChordLayout(notes,pose){
    const normalized=(notes || [])
      .filter(n=>
        n &&
        Number.isInteger(n.s) && n.s>=0 && n.s<6 &&
        Number.isFinite(n.f) && n.f>=0 && n.f<=TOTAL_FRETS
      )
      .map(n=>({
        s:n.s,
        f:n.f,
        finger:n.f===0?null:n.finger
      }));

    const thickness=fingerRectThickness();

    // IMPORTANT: exactly the same base X as ordinary single-note playback.
    const originX=bd.clientWidth+thickness;
    const restX=playbackRestX(pose);

    const fingers=[];
    const barres=[];

    for(let finger=0;finger<4;finger++){
      const assigned=normalized
        .filter(n=>n.f>0 && fingerIndex(n.finger)===finger)
        .sort((a,b)=>a.f-b.f || a.s-b.s);

      const laneFret=Math.max(
        1,
        Math.min(TOTAL_FRETS,pose.baseFret+finger)
      );
      const laneY=56+yForFret(laneFret);

      if(!assigned.length){
        fingers.push({
          o:{x:originX,y:laneY},
          e:{x:restX,y:laneY},
          on:false
        });
        continue;
      }

      const barre=chordBarreInfo(
        normalized.map(n=>({
          ...n,
          finger:n.f===0?null:fingerIndex(n.finger)
        })),
        finger
      );

      const focus=barre ? barre.farNote : assigned[0];
      const tip=shellPoint(focus.s,focus.f);

      let baseY=laneY;

      if(barre){
        /*
          Preserve the successful prototype barre behavior, but apply its
          release only to the barre finger itself. Do not move the entire hand
          row vertically when a chord appears.
        */
        baseY=
          laneY*(1-barre.release) +
          tip.y*barre.release;

        barres.push({
          finger,
          count:barre.count,
          span:barre.span,
          fret:barre.fret,
          release:barre.release,
          full:barre.full,
          x1:barre.x1,
          x2:barre.x2,
          y:barre.y
        });
      }

      fingers.push({
        o:{x:originX,y:baseY},
        e:tip,
        on:true
      });
    }

    return {fingers,barres};
  }

  function drawStablePlaybackChordHand(notes,pose,instant=false){
    const layout=computeStablePlaybackChordLayout(notes,pose);

    layout.fingers.forEach((g,i)=>
      setChordFingerRect(fingerRects[i],g,instant)
    );

    drawChordBarres(layout);
    return layout;
  }

  function showPlaybackFingers(){
    document.body.classList.add('fingeringPlayback');
    fingerLayer.style.display='block';
  }

  function hidePlaybackFingers(){
    document.body.classList.remove('fingeringPlayback');
    fingerLayer.style.display='';
  }

  async function performMovementPlayback(
    e,
    run,
    {withHand=false,targetPose=null}={}
  ){
    if(!isMoveEvent(e)) return;

    if(e.movement===MOVEMENT_TYPE.HAMMER){
      await connectedMarkerMoveWithCue(
        e.to,
        scaledPlaybackMs(PLAYBACK_TIMING.CONNECTED_MARKER_MS,e),
        run,
        ()=>playHammerOnArticulation(e)
      );
      return;
    }

    if(e.movement===MOVEMENT_TYPE.PULL){
      if(withHand && targetPose){
        // Destination finger arrives before the origin releases.
        const prepared=pullOffPreparedPose(e,targetPose);
        prepared.baseFret=targetPose.baseFret;
        prepared.activeString=targetPose.activeString;
        drawFingerPose(prepared,false);

        await sleep(scaledPlaybackMs(PLAYBACK_TIMING.PULL_PREPARE_MS,e));
        if(run!==S.runId) return;
      }

      playPullOffRelease(e);

      if(withHand && targetPose){
        drawFingerPose(targetPose,false);
      }

      await sleep(scaledPlaybackMs(PLAYBACK_TIMING.PULL_RELEASE_CUE_MS,e,12));
      if(run!==S.runId) return;

      await connectedMarkerMoveWithCue(
        e.to,
        scaledPlaybackMs(PLAYBACK_TIMING.CONNECTED_MARKER_MS,e),
        run,
        ()=>playPullOffResult(e)
      );
      return;
    }

    if(e.movement===MOVEMENT_TYPE.SLIDE){
      const audioPromise=playSlideArticulation(e,run);
      await connectedMarkerMove(
        e.to,
        scaledPlaybackMs(PLAYBACK_TIMING.SLIDE_MS,e),
        run
      );
      await audioPromise;
      return;
    }

    if(e.movement!==MOVEMENT_TYPE.BEND) return;

    if(isPreBendEvent(e)){
      const timing=preBendTiming(e);
      let handPromise=Promise.resolve();

      if(withHand && targetPose){
        const prePose=preBentPoseFromFinal(targetPose,e);
        drawFingerPose(prePose,true);

        handPromise=(async()=>{
          await sleep(timing.hold);
          if(run!==S.runId) return;
          drawFingerPoseTimed(targetPose,timing.release);
          if(timing.release>0) await sleep(timing.release);
        })();
      }

      await Promise.all([
        preBendReleaseMarkerMove(e,timing.total,run),
        handPromise
      ]);
      return;
    }

    if(isBendReleaseEvent(e)){
      releaseBendArticulation(e);
    }else{
      startBendArticulation(e);
    }

    await bendMarkerMove(e,scaledPlaybackMs(PLAYBACK_TIMING.BEND_MS,e),run);
  }

  async function playFingeredOne(e,run){
    showPlaybackFingers();
    clearChordBarres();
    const startedAt=performance.now();

    /*
      IMPORTANT:
      Fingering assignment already produces the correct physical hand.
      Player now uses that EXACT event-to-pose calculation, with no
      Player-only base-fret or active-string stabilization layered on top.
    */
    const previousPose=cloneFingerPose(S.fingerPose);
    const target=nextFingerPoseForEvent(previousPose,e);
    S.fingerPose=target;

    const pull=isMoveEvent(e,MOVEMENT_TYPE.PULL);
    const preBend=isPreBendEvent(e);

    if(e.type===EVENT_TYPE.FINGER_ON){
      // This is the same hand transition used when a finger is assigned:
      // calculate the event pose, then draw it directly.
      drawFingerPose(target,false);

      await discretePluckMarker(e,run);
      if(run!==S.runId) return;

      playStringSample(
        e.s,
        e.f,
        .20,
        Math.max(.18,eventDurationMs(e)/1000*.92)
      );
    }else if(isMoveEvent(e)){
      // Pull-off and pre-bend have their own preparation poses.
      if(!pull && !preBend){
        drawFingerPose(target,false);
      }

      await performMovementPlayback(
        e,
        run,
        {withHand:true,targetPose:target}
      );
      if(run!==S.runId) return;
    }

    await waitForTimedEventWindow(startedAt,e,run);
  }


  async function playFingerDemoOne(e,run){
    return playFingeredOne(e,run);
  }

  async function playFingeringDemo(){
    stopPlayback(false);
    document.body.classList.add('fingerDemo');
    fingerLayer.style.display='block';

    const run=++S.runId;
    S.playback=blankState();
    S.fingerPose=blankFingerPose();
    drawFingerPose(S.fingerPose,true);
    progressFill.style.width='0%';

    // bindTap has already unlocked iOS Web Audio synchronously.
    // Here we simply finish/attempt sample loading; oscillator fallback remains available.
    await unlockSampleAudio();
    if(run!==S.runId) return;

    const events=fingerDemoEvents();
    const timed=events.filter(isTimedEvent);
    let timedIndex=0;

    // Load the scale framework first; it consumes no demo playback time.
    for(const e of events){
      if(isTimedEvent(e)) continue;
      applyEventInstant(S.playback,e);
    }
    renderPlayback();

    for(const e of events){
      if(run!==S.runId) return;
      if(!isTimedEvent(e)) continue;

      timedIndex++;
      statusEl.innerHTML=`<strong>Finger Demo ${timedIndex}/${timed.length}</strong><br>${describe(e)}`;
      progressFill.style.width=`${((timedIndex-1)/timed.length)*100}%`;
      await playFingerDemoOne(e,run);
    }

    if(run===S.runId){
      progressFill.style.width='100%';
      statusEl.innerHTML='<strong>Finger Demo finished</strong><br>Playback integration test complete.';
    }
  }

  function bindTap(el,fn){
    let pointer=false;
    el.addEventListener('pointerup',e=>{
      pointer=true;
      e.preventDefault();
      e.stopPropagation();
      unlockAudioFromGesture();
      fn();
      setTimeout(()=>pointer=false,250);
    },{passive:false});
    el.addEventListener('click',e=>{
      if(pointer)return;
      e.preventDefault();
      e.stopPropagation();
      unlockAudioFromGesture();
      fn();
    });
  }

  function drawBoard(){
    bd.innerHTML='';
    orow.innerHTML='';
    const X=stringXs();

    X.forEach((x,i)=>{
      const st=document.createElement('div');
      st.className='string';
      st.style.left=x+'px';
      st.style.width=(1.15+(5-i)*.33)+'px';
      bd.appendChild(st);

      const o=document.createElement('div');
      o.className='open';
      o.style.left=x+'px';
      o.textContent=NAMES[TUNING[i]%12];
      orow.appendChild(o);

      const h=document.createElement('div');
      h.className='openhit';
      h.style.left=x+'px';
      bindTap(h,()=>handlePosition(i,0));
      orow.appendChild(h);
    });

    for(let f=1;f<=TOTAL_FRETS;f++){
      const fr=document.createElement('div');
      fr.className='fret';
      fr.style.top=fretY(f)+'px';
      bd.appendChild(fr);

      const lab=document.createElement('div');
      lab.className='fretlab';
      lab.style.top=yForFret(f)+'px';
      lab.textContent=f;
      bd.appendChild(lab);
    }

    [3,5,7,9,12,15].forEach(f=>{
      const y=yForFret(f);
      if(f===12){
        [-16,16].forEach(dx=>{
          const d=document.createElement('div');
          d.className='inlay';
          d.style.left=`calc(50% + ${dx}px)`;
          d.style.top=y+'px';
          bd.appendChild(d);
        });
      }else{
        const d=document.createElement('div');
        d.className='inlay';
        d.style.top=y+'px';
        bd.appendChild(d);
      }
    });

    for(let s=0;s<6;s++){
      for(let f=1;f<=TOTAL_FRETS;f++){
        const h=document.createElement('div');
        h.className='hit';
        h.style.left=X[s]+'px';
        h.style.top=yForFret(f)+'px';
        h.style.height=Math.max(30,fretY(f)-fretY(f-1))+'px';
        bindTap(h,()=>handlePosition(s,f));
        bd.appendChild(h);
      }
    }
    renderAuthor();
  }

  function frameworkMarkClass(p){
    const base=`frameworkMark ${isInKey(p.s,p.f)?'in':'out'}`;
    return p.f===0 ? `${base} openPhantom` : base;
  }

  function fingerMarkClass(p,extra=''){
    const parts=['fingerMark'];
    if(p && p.f===0) parts.push('openPhantom');
    if(extra) parts.push(extra);
    return parts.join(' ');
  }

  function makeMark(cls,s,f,text=''){
    const host=f===0?orow:bd;
    const d=document.createElement('div');
    d.className=cls;
    d.style.left=stringXs()[s]+'px';
    d.style.top=(f===0?32:yForFret(f))+'px';
    d.textContent=text;
    d.dataset.pitchString=String(s);
    d.dataset.pitchFret=String(f);
    host.appendChild(d);
    return d;
  }

  function clearOverlays(){
    document.querySelectorAll(
      '.frameworkMark,.fingerMark,.moveLabel,.articulationSpark,.chordBarreLine,.editTargetRing,.editOriginRing'
    ).forEach(x=>x.remove());
    moveSvg.innerHTML='';
  }

  function renderState(st){
    clearOverlays();
    for(const p of st.framework.values()){
      makeMark(frameworkMarkClass(p),p.s,p.f,positionLabel(p.s,p.f,'auto'));
    }
    for(const p of st.fingers.values()){
      if(p.kind==='bendRing'){
        makeMark(fingerMarkClass(p,'bendRing'),p.s,p.f,'');
      }else{
        makeMark(fingerMarkClass(p),p.s,p.f,positionLabel(p.s,p.f,'auto'));
      }
    }
  }

  function renderAuthor(){renderState(S.author)}
  function renderPlayback(){renderState(S.playback)}

  function applyEventInstant(st,e){
    const k=(e.s!==undefined && e.f!==undefined)?posKey(e.s,e.f):null;

    if(e.type==='frameworkOn') st.framework.set(k,{s:e.s,f:e.f});
    if(e.type==='frameworkOff') st.framework.delete(k);

    if(e.type==='fingerOn'){
      st.fingers.set(k,{
        s:e.s,
        f:e.f,
        kind:e.f===0?'openRing':'solid'
      });
      st.currentOrigin={s:e.s,f:e.f};
    }

    if(e.type==='fingerOff'){
      st.fingers.delete(k);
      // Any Admin OFF action breaks the implied continuation.
      st.currentOrigin=null;
    }

    if(e.type===EVENT_TYPE.REST){
      st.fingers.clear();
      st.currentOrigin=null;
    }

    if(e.type==='chord'){
      for(const note of e.notes || []){
        const nk=posKey(note.s,note.f);
        st.fingers.set(nk,{
          s:note.s,
          f:note.f,
          kind:note.f===0?'openRing':'solid',
          chordId:e.chordId
        });
      }

      // A chord has no single unambiguous movement origin.
      st.currentOrigin=null;
    }

    if(isChordMoveEvent(e)){
      // Replace the complete prior chord state with the resulting chord state.
      // This keeps unchanged chord voices held while only one voice moves.
      for(const note of e.chordBefore || []){
        st.fingers.delete(posKey(note.s,note.f));
      }

      for(const note of e.chordAfter || []){
        const isMoving=note.s===e.to.s && note.f===e.to.f;
        const bentUp=(
          e.movement===MOVEMENT_TYPE.BEND &&
          e.bendPhase===BEND_PHASE.UP &&
          isMoving
        );

        st.fingers.set(posKey(note.s,note.f),{
          s:note.s,
          f:note.f,
          kind:bentUp ? 'bendRing' : (note.f===0?'openRing':'solid'),
          chordId:e.chordId,
          bendId:bentUp ? e.bendId : undefined,
          bendFrom:bentUp ? clonePos(e.bendHome || e.from) : undefined
        });
      }

      // Chord movement has no single implied origin for the next generic move.
      st.currentOrigin=null;
      return;
    }

    if(e.type==='move'){
      const ok=posKey(e.from.s,e.from.f);
      const dk=posKey(e.to.s,e.to.f);

      st.fingers.delete(ok);

      if(e.movement==='bend' && e.bendPhase==='up'){
        // Bent pitch is not a literal finger placement, so represent it as a ring.
        st.fingers.set(dk,{
          s:e.to.s,f:e.to.f,
          kind:'bendRing',
          bendId:e.bendId,
          bendFrom:clonePos(e.from)
        });
      }else{
        // Open strings are phantom sounding positions, never physical fingers.
        st.fingers.set(dk,{
          s:e.to.s,
          f:e.to.f,
          kind:e.to.f===0?'openRing':'solid'
        });
      }

      st.currentOrigin={s:e.to.s,f:e.to.f};
    }
  }

  function selectedAuthorEditEvent(){
    if(!Number.isInteger(S.editEventIndex)) return null;
    return S.events[S.editEventIndex] || null;
  }

  function authorEventEditableInCurrentMode(e){
    if(!e || S.fingeringAssign.active) return false;

    if(S.tool==='framework'){
      return isFrameworkEvent(e);
    }

    if(S.tool==='finger'){
      return e.type==='fingerOn' || e.type==='move' || e.type==='chord' || e.type===EVENT_TYPE.REST;
    }

    return false;
  }

  function authorModeHistoryKey(){
    return S.tool==='framework' ? 'framework' : 'played';
  }

  function makeAuthorSnapshot(){
    return {
      events:cloneEvents(S.events),
      editEventIndex:Number.isInteger(S.editEventIndex)
        ? S.editEventIndex
        : null,
      editSelectionKind:S.editSelectionKind || null,
      nextBendId:S.nextBendId,
      nextChordId:S.nextChordId
    };
  }

  function pushAuthorSnapshot(){
    const key=authorModeHistoryKey();
    const stack=S.authorEditHistory[key];
    stack.push(makeAuthorSnapshot());
    if(stack.length>100) stack.shift();
  }

  function clearAuthorHistoryForMode(key=authorModeHistoryKey()){
    if(S.authorEditHistory[key]) S.authorEditHistory[key]=[];
  }

  function restoreAuthorSnapshot(snapshot){
    if(!snapshot) return false;

    S.events=cloneEvents(snapshot.events);
    S.editEventIndex=Number.isInteger(snapshot.editEventIndex)
      ? snapshot.editEventIndex
      : null;
    S.editSelectionKind=S.editEventIndex!==null
      ? (snapshot.editSelectionKind || 'edit')
      : null;
    S.nextBendId=snapshot.nextBendId || 1;
    S.nextChordId=snapshot.nextChordId || 1;
    resetPendingAuthoringState();
    rebuildAuthor();
    return true;
  }

  function stateThroughEvent(eventIndex){
    const st=blankState();
    for(let i=0;i<=eventIndex && i<S.events.length;i++){
      applyEventInstant(st,S.events[i]);
    }
    return st;
  }

  function addEditRing(pos,origin=false){
    if(!pos) return null;

    const ring=makeMark(
      origin ? 'editOriginRing' : 'editTargetRing',
      pos.s,
      pos.f,
      ''
    );

    /*
      The visible white target ring is the authoritative edit hit target.
      This avoids relying on Safari to pass a touch through the overlay to the
      smaller underlying fretboard .hit element.
    */
    if(!origin){
      bindTap(ring,()=>{
        if(!Number.isInteger(S.editEventIndex)) return;

        if(S.editSelectionKind==='timing'){
          clearAuthorEditSelection(true);
          statusEl.innerHTML=toolHelp();
          return;
        }

        handlePosition(pos.s,pos.f);
      });
    }

    return ring;
  }

  function renderSelectedAuthorEvent(){
    const e=selectedAuthorEditEvent();
    if(!e){
      renderAuthor();
      return;
    }

    renderState(stateThroughEvent(S.editEventIndex));

    if(isFrameworkEvent(e) || e.type==='fingerOn'){
      addEditRing({s:e.s,f:e.f});
      return;
    }

    if(e.type==='move'){
      addEditRing(e.from,true);
      addEditRing(e.to,false);
      return;
    }

    if(e.type==='chord'){
      for(const note of e.notes || []){
        addEditRing(note,false);
      }
      return;
    }

    // Rests have no fretboard position. The score itself remains selected.
    if(e.type===EVENT_TYPE.REST) return;
  }

  function clearAuthorEditSelection(render=true){
    S.editEventIndex=null;
    S.editSelectionKind=null;
    S.previewEventIndex=null;
    if(render){
      renderAuthor();
      renderEventList();
      updateChordButton();
      renderScore();
    }else{
      updateDurationEditor();
    }
  }

  function authorEditHelp(e){
    if(!e) return toolHelp();

    if(isFrameworkEvent(e)){
      const action=e.type==='frameworkOn'?'ON':'OFF';
      return `<strong>Editing Framework ${action}</strong><br>`+
        `Tap another position to move this stored event. `+
        `Tap its highlighted position to change it to Framework ${action==='ON'?'OFF':'ON'}. `+
        `Tap the selected sequence row again to finish editing.`;
    }

    if(e.type==='fingerOn'){
      return '<strong>Editing played note</strong><br>'+
        'Tap another fretboard position to move this stored pluck. '+
        'Tap its white highlighted ring to remove it. '+
        'Moving it clears its fingering assignment so it can be checked again.';
    }

    if(e.type==='move'){
      if(isChordMoveEvent(e)){
        const suffix=(e.movement===MOVEMENT_TYPE.BEND && e.bendPhase===BEND_PHASE.RELEASE)
          ? ' release'
          : '';
        return `${prettyMove(e.movement)}${suffix} in chord ${noteName(e.from.s,e.from.f)}→${noteName(e.to.s,e.to.f)}${fingerSuffix(e)} · ${durationSymbolForEvent(e)}`;
      }
      if(e.movement==='bend' && e.bendPhase==='pre-release'){
        return '<strong>Editing Pre-bend release</strong><br>'+
          'Tap a different lower fret on the same string to change the physical finger position.';
      }
      return `<strong>Editing ${prettyMove(e.movement)}</strong><br>`+
        'Tap a new destination to change this stored movement, or press a Movement button to change its type.';
    }

    if(e.type==='chord'){
      return '<strong>Editing chord</strong><br>'+
        'Tap an empty position to add it to this stored chord. '+
        'Tap a chord position to remove it. A chord must keep at least two notes.';
    }

    if(e.type===EVENT_TYPE.REST){
      return '<strong>Editing rest</strong><br>'+
        'Use − and + above the score to change its duration.';
    }

    return toolHelp();
  }

  function selectAuthorEventForEditing(eventIndex,row){
    const e=S.events[eventIndex];
    if(!e) return;

    if(!authorEventEditableInCurrentMode(e)){
      statusEl.innerHTML=S.tool==='framework'
        ? '<strong>Not a Framework event.</strong><br>Choose a Frame + or Frame − row, or switch to Played Notes.'
        : '<strong>Not a Played Notes event.</strong><br>Choose a Pluck, movement, Chord, or Rest row, or switch to Framework.';
      return;
    }

    if(S.editEventIndex===eventIndex){
      clearAuthorEditSelection(true);
      statusEl.innerHTML=toolHelp();
      return;
    }

    resetPendingAuthoringState();
    S.previewEventIndex=null;
    S.editEventIndex=eventIndex;
    S.editSelectionKind='edit';

    renderSelectedAuthorEvent();
    renderEventList();

    const selectedRow=eventPanel.querySelector(
      `.event[data-original-index="${eventIndex}"]`
    );
    if(selectedRow){
      selectedRow.classList.add('selected');
      selectedRow.scrollIntoView({block:'nearest'});
    }

    auditionEventPitch(e);
    statusEl.innerHTML=authorEditHelp(e);
    updateChordButton();
  }

  function clearEventFingering(e){
    if(!e) return;

    if(e.type==='fingerOn'){
      delete e.finger;
      return;
    }

    if(e.type==='move'){
      delete e.finger;
      delete e.fromFinger;
      delete e.toFinger;
      return;
    }

    if(e.type==='chord'){
      for(const note of e.notes || []){
        delete note.finger;
      }
    }
  }

  function validateEditedMove(e,to){
    if(!e || e.type!=='move') return 'Select a movement row first.';
    const from=e.from;

    if(!from) return 'This movement has no origin.';
    if(from.s!==to.s) return `${prettyMove(e.movement)} must stay on the same string.`;
    if(from.f===to.f) return 'Choose a different destination note.';

    if(e.movement==='hammer-on' && to.f<from.f)
      return 'A hammer-on destination must be higher in pitch.';

    if(e.movement==='pull-off' && to.f>from.f)
      return 'A pull-off destination must be lower in pitch.';

    if(e.movement==='bend'){
      if(e.bendPhase==='release'){
        const home=e.bendHome;
        if(home && !samePos(home,to))
          return 'A bend release must return to its original fret.';
      }else if(e.bendPhase==='pre-release'){
        if(to.f<=0)
          return 'A pre-bend needs a fretted physical finger position.';
        if(to.f>=from.f)
          return 'A pre-bend physical position must be lower than its sounding phantom pitch.';
      }else if(to.f<from.f){
        return 'A bend destination must be higher in pitch.';
      }
    }

    return '';
  }

  function editSelectedFrameworkEvent(s,f){
    const e=selectedAuthorEditEvent();
    if(!e || !isFrameworkEvent(e)) return false;

    pushAuthorSnapshot();

    if(e.s===s && e.f===f){
      e.type=e.type==='frameworkOn'?'frameworkOff':'frameworkOn';
    }else{
      e.s=s;
      e.f=f;
    }

    rebuildAuthor();
    auditionPositions([{s,f}]);
    statusEl.innerHTML=authorEditHelp(e);
    return true;
  }

  function editSelectedPlayedEventAt(s,f){
    const e=selectedAuthorEditEvent();
    if(!e || S.tool!=='finger') return false;

    if(e.type==='fingerOn'){
      if(e.s===s && e.f===f){
        // Direct-edit removal: tapping the selected stored pluck itself
        // deletes that event rather than appending a compensating Finger Off.
        pushAuthorSnapshot();

        const removedIndex=S.editEventIndex;
        S.events.splice(removedIndex,1);
        S.editEventIndex=null;
        S.editSelectionKind=null;
        S.previewEventIndex=null;

        rebuildAuthor();
        playUiClick();
        statusEl.innerHTML=
          '<strong>Played note removed.</strong><br>'+
          'Select another Played Notes row to edit, or tap the fretboard to add a new note.';
        return true;
      }

      pushAuthorSnapshot();
      e.s=s;
      e.f=f;
      delete e.finger;

      rebuildAuthor();
      auditionDynamicNote(s,f,.20);
      statusEl.innerHTML=authorEditHelp(e);
      return true;
    }

    if(e.type==='move'){
      const to={s,f};
      const err=validateEditedMove(e,to);
      if(err){
        announce(err,false);
        return true;
      }

      pushAuthorSnapshot();
      e.to=to;
      clearEventFingering(e);

      if(e.movement==='bend'){
        if(e.bendPhase==='pre-release'){
          e.bendHome=clonePos(e.to);
        }else if(e.bendPhase!=='release'){
          e.bendHome=clonePos(e.from);
        }
      }

      rebuildAuthor();
      auditionEventPitch(e);
      statusEl.innerHTML=authorEditHelp(e);
      return true;
    }

    if(e.type==='chord'){
      const index=(e.notes || []).findIndex(note=>note.s===s && note.f===f);

      if(index>=0){
        if(e.notes.length<=2){
          announce('A chord must keep at least two notes.',false);
          return true;
        }

        pushAuthorSnapshot();
        e.notes.splice(index,1);
      }else{
        pushAuthorSnapshot();
        e.notes.push({s,f});
      }

      rebuildAuthor();
      auditionEventPitch(e);
      statusEl.innerHTML=authorEditHelp(e);
      return true;
    }

    return false;
  }

  function editSelectedMovementType(kind){
    const e=selectedAuthorEditEvent();
    if(!e || e.type!=='move') return false;

    if(kind==='chord'){
      statusEl.innerHTML='<strong>Editing a movement.</strong><br>Choose Bend, Hammer-on, Pull-off, or Slide.';
      return true;
    }

    const candidate={
      ...e,
      movement:kind
    };

    // Changing a bend release into another movement makes it an ordinary move.
    if(kind!=='bend'){
      delete candidate.bendId;
      delete candidate.bendPhase;
      delete candidate.bendHome;
    }else{
      candidate.bendId=e.bendId || 'bend-'+S.nextBendId;
      if(e.movement==='bend' && e.bendPhase==='pre-release'){
        candidate.bendPhase='pre-release';
        candidate.bendHome=clonePos(candidate.to);
      }else{
        candidate.bendPhase='up';
        candidate.bendHome=clonePos(candidate.from);
      }
    }

    const err=validateEditedMove(candidate,candidate.to);
    if(err){
      announce(err,false);
      return true;
    }

    pushAuthorSnapshot();

    e.movement=kind;
    clearEventFingering(e);

    if(kind==='bend'){
      if(!e.bendId) e.bendId='bend-'+(S.nextBendId++);
      if(e.bendPhase==='pre-release'){
        e.bendHome=clonePos(e.to);
      }else{
        e.bendPhase='up';
        e.bendHome=clonePos(e.from);
      }
    }else{
      delete e.bendId;
      delete e.bendPhase;
      delete e.bendHome;
    }

    resetPendingAuthoringState();
    rebuildAuthor();
    auditionEventPitch(e);
    statusEl.innerHTML=authorEditHelp(e);
    return true;
  }

  function rebuildAuthor(){
    S.author=blankState();
    for(const e of S.events) applyEventInstant(S.author,e);

    if(
      Number.isInteger(S.editEventIndex) &&
      S.editEventIndex>=0 &&
      S.editEventIndex<S.events.length
    ){
      renderSelectedAuthorEvent();
    }else{
      S.editEventIndex=null;
      S.editSelectionKind=null;
      renderAuthor();
    }

    renderEventList();
    updateChordButton();
  }

  function playableEvents(){return S.events.filter(e=>e.play!==false)}

  function isTimedEvent(e){
    if(!e || e.play===false) return false;
    return !isFrameworkEvent(e);
  }

  function currentFingerEntry(){
    if(!S.author.currentOrigin) return null;
    return S.author.fingers.get(posKey(S.author.currentOrigin.s,S.author.currentOrigin.f)) || null;
  }

  function currentOriginSourceRef(){
    if(!S.author.currentOrigin) return null;
    const refs=activePinkSourceMap();
    const ref=refs.get(posKey(S.author.currentOrigin.s,S.author.currentOrigin.f));
    return ref || null;
  }

  function renderPendingPreBendChoice(){
    renderAuthor();

    const pb=S.pendingPreBend;
    if(!pb || !pb.sounding) return;

    // Remove the ordinary solid marker at the sounding pitch and replace it
    // with a labeled phantom ring while the app waits for the physical fret.
    document.querySelectorAll('.fingerMark').forEach(el=>{
      const ss=Number(el.dataset.pitchString);
      const ff=Number(el.dataset.pitchFret);
      if(
        ss===pb.sounding.s &&
        ff===pb.sounding.f &&
        !el.classList.contains('bendRing')
      ){
        el.remove();
      }
    });

    makeMark(
      'fingerMark bendRing preBendPitchRing',
      pb.sounding.s,
      pb.sounding.f,
      positionLabel(pb.sounding.s,pb.sounding.f,'admin')
    );
  }

  function clearPendingPreBend(render=false){
    const had=!!S.pendingPreBend;
    S.pendingPreBend=null;
    if(render && had) renderAuthor();
  }

  function activePinkSourceMap(){
    const sources=new Map();

    S.events.forEach((e,eventIndex)=>{
      if(e.type==='fingerOn'){
        sources.set(posKey(e.s,e.f),{
          eventIndex,
          type:'fingerOn'
        });
        return;
      }

      if(e.type==='fingerOff'){
        sources.delete(posKey(e.s,e.f));
        return;
      }

      if(isChordMoveEvent(e)){
        for(const note of e.chordBefore || []){
          sources.delete(posKey(note.s,note.f));
        }
        (e.chordAfter || []).forEach((note,noteIndex)=>{
          sources.set(posKey(note.s,note.f),{
            eventIndex,
            type:'chordMove',
            noteIndex
          });
        });
        return;
      }

      if(e.type==='move'){
        sources.delete(posKey(e.from.s,e.from.f));
        sources.set(posKey(e.to.s,e.to.f),{
          eventIndex,
          type:'move'
        });
        return;
      }

      if(e.type==='chord'){
        (e.notes || []).forEach((note,noteIndex)=>{
          sources.set(posKey(note.s,note.f),{
            eventIndex,
            type:'chord',
            noteIndex
          });
        });
        return;
      }

      if(e.type===EVENT_TYPE.REST){
        sources.clear();
      }
    });

    return sources;
  }

  function currentPinkPositions(){
    return [...S.author.fingers.values()]
      .filter(p=>p && p.kind!=='bendRing')
      .map(p=>({s:p.s,f:p.f}))
      .sort((a,b)=>a.s-b.s || a.f-b.f);
  }

  function currentChordMovementContext(){
    const visible=[...S.author.fingers.values()]
      .filter(Boolean)
      .map(p=>({s:p.s,f:p.f}));

    if(visible.length<2) return null;

    const refs=activePinkSourceMap();
    const sourceRefs=visible
      .map(pos=>refs.get(posKey(pos.s,pos.f)))
      .filter(Boolean);

    if(sourceRefs.length!==visible.length) return null;

    const eventIndexes=[...new Set(sourceRefs.map(r=>r.eventIndex))];
    if(eventIndexes.length!==1) return null;

    const eventIndex=eventIndexes[0];
    const source=S.events[eventIndex];
    if(!source) return null;

    let notes=null;
    if(source.type===EVENT_TYPE.CHORD){
      notes=source.notes;
    }else if(isChordMoveEvent(source)){
      notes=source.chordAfter;
    }

    if(!Array.isArray(notes) || notes.length<2) return null;

    return {
      eventIndex,
      source,
      chordId:source.chordId || source.sourceChordId || ('chord-'+eventIndex),
      notes:cloneEvents(notes)
    };
  }

  function updateChordButton(){
    if(!chordBtn) return;
    const ready=
      !document.body.classList.contains('player') &&
      !S.fingeringAssign.active &&
      S.tool==='finger' &&
      S.editSelectionKind!=='edit' &&
      currentPinkPositions().length>1;

    chordBtn.disabled=!ready;
    chordBtn.classList.toggle('ready',ready);
  }

  function groupCurrentPinkAsChord(){
    renderScore();

    if(S.fingeringAssign.active) return;

    if(Number.isInteger(S.editEventIndex) && S.editSelectionKind==='edit'){
      statusEl.innerHTML='<strong>Finish editing the selected row first.</strong><br>Tap the selected row again, then use Chord on the current Played Notes state.';
      return;
    }

    if(S.editSelectionKind==='timing'){
      clearAuthorEditSelection(false);
    }

    exitSequencePreview();

    if(S.tool!=='finger') setTool('finger');

    const visible=currentPinkPositions();
    if(visible.length<2){
      announce('Add at least two pink notes before creating a chord.',false);
      return;
    }

    const sources=activePinkSourceMap();
    const refs=visible.map(pos=>({
      pos,
      source:sources.get(posKey(pos.s,pos.f))
    }));

    if(refs.some(r=>!r.source)){
      announce('One of the visible pink notes could not be traced to its source event.',false);
      return;
    }

    const sourceIndexes=[...new Set(refs.map(r=>r.source.eventIndex))];
    const sourceEvents=sourceIndexes.map(i=>S.events[i]);

    if(
      sourceIndexes.length===1 &&
      sourceEvents[0] &&
      (
        sourceEvents[0].type===EVENT_TYPE.CHORD ||
        isChordMoveEvent(sourceEvents[0])
      )
    ){
      announce('These pink notes are already one chord state.',false);
      return;
    }

    /*
      Keep chord creation intentionally conservative around movements. A
      movement carries its own articulation/timing semantics, so silently
      collapsing one into a chord would destroy that information.
    */
    if(sourceEvents.some(e=>e && e.type==='move')){
      announce('A movement-derived pink note cannot be folded into a chord yet. Use ordinary Played Notes for the chord shape.',false);
      return;
    }

    const notes=refs.map(({pos,source})=>{
      const sourceEvent=S.events[source.eventIndex];
      let finger=null;

      if(sourceEvent.type==='fingerOn'){
        finger=validFingerLetter(sourceEvent.finger)
          ? fingerLetter(sourceEvent.finger)
          : null;
      }else if(sourceEvent.type==='chord'){
        const oldNote=sourceEvent.notes[source.noteIndex];
        finger=oldNote && validFingerLetter(oldNote.finger)
          ? fingerLetter(oldNote.finger)
          : null;
      }

      const note={s:pos.s,f:pos.f};
      if(finger) note.finger=finger;
      return note;
    });

    const maxIndex=Math.max(...sourceIndexes);
    const removeSet=new Set(sourceIndexes);

    const latestSourceEvent=S.events[maxIndex];
    const chordEvent={
      type:'chord',
      chordId:'chord-'+(S.nextChordId++),
      notes,
      durationUnits:eventDurationUnits(latestSourceEvent),
      play:true
    };

    pushAuthorSnapshot();

    const rebuilt=[];
    for(let i=0;i<S.events.length;i++){
      if(i===maxIndex){
        rebuilt.push(chordEvent);
        continue;
      }
      if(removeSet.has(i)) continue;
      rebuilt.push(S.events[i]);
    }

    S.events=rebuilt;
    resetPendingAuthoringState();
    rebuildAuthor();

    shell.classList.remove('chordConfirmPulse');
    shell.getBoundingClientRect();
    shell.classList.add('chordConfirmPulse');
    setTimeout(()=>shell.classList.remove('chordConfirmPulse'),450);

    const names=notes.map(n=>noteName(n.s,n.f)).join(' · ');
    auditionEventPitch(chordEvent);
    announce(`Chord: ${names}`,true);
  }

  function validateMove(kind,from,to,fromEntry){
    if(!from) return 'Add a pink origin note before selecting a movement.';
    if(from.s!==to.s) return `${prettyMove(kind)} must stay on the same string.`;
    if(from.f===to.f) return 'Choose a different destination note.';

    if(kind==='hammer-on' && to.f<from.f)
      return 'A hammer-on destination must be higher in pitch.';

    if(kind==='pull-off' && to.f>from.f)
      return 'A pull-off destination must be lower in pitch.';

    if(kind==='bend'){
      if(fromEntry && fromEntry.kind==='bendRing'){
        const home=fromEntry.bendFrom;
        if(!home || to.s!==home.s || to.f!==home.f)
          return 'To release this bend, tap its linked original fret.';
      }else if(to.f<from.f){
        return 'A bend from a solid pink note must go to a higher pitch.';
      }
    }
    return '';
  }

  function handlePosition(s,f){
    if(document.body.classList.contains('player')) return;

    if(S.fingeringAssign.active){
      handleChordFingeringPositionTap(s,f);
      return;
    }

    if(Number.isInteger(S.editEventIndex)){
      if(S.editSelectionKind==='edit'){
        if(S.tool==='framework'){
          editSelectedFrameworkEvent(s,f);
          return;
        }

        if(S.tool==='finger'){
          editSelectedPlayedEventAt(s,f);
          return;
        }
      }else if(S.editSelectionKind==='timing'){
        clearAuthorEditSelection(false);
      }
    }

    exitSequencePreview();
    const k=posKey(s,f);

    if(S.tool==='framework'){
      pushAuthorSnapshot();
      S.events.push({
        type:S.author.framework.has(k)?'frameworkOff':'frameworkOn',
        s,f,
        play:true
      });
      rebuildAuthor();
      auditionPositions([{s,f}]);
      announce(`Framework ${S.author.framework.has(k)?'on':'off'}: ${noteName(s,f)}`,true);
      return;
    }

    if(S.tool!=='finger') return;

    if(S.pendingMove){
      const to={s,f};

      if(S.pendingChordMove){
        const ctx=S.pendingChordMove;
        const before=cloneEvents(ctx.notes || []);
        const movingIndex=before.findIndex(note=>note.s===s);

        if(movingIndex<0){
          announce('Tap a destination on a string already used by the chord.',false);
          return;
        }

        const from=clonePos(before[movingIndex]);
        const sourceEvent=ctx.source;
        let fromEntry=null;

        // If the previous chord movement was a bend-up on this string, a
        // second Bend gesture may release it back to its physical home fret.
        const releasingPriorBend=!!(
          S.pendingMove===MOVEMENT_TYPE.BEND &&
          isChordMoveEvent(sourceEvent) &&
          sourceEvent.movement===MOVEMENT_TYPE.BEND &&
          sourceEvent.bendPhase===BEND_PHASE.UP &&
          sourceEvent.to &&
          sourceEvent.to.s===s &&
          sourceEvent.bendHome &&
          to.s===sourceEvent.bendHome.s &&
          to.f===sourceEvent.bendHome.f
        );

        let err='';
        if(releasingPriorBend){
          if(to.f===from.f) err='Choose the original fret to release the bend.';
        }else{
          err=validateMove(S.pendingMove,from,to,fromEntry);
        }

        if(err){
          announce(err,false);
          return;
        }

        const after=cloneEvents(before);
        after[movingIndex]={...after[movingIndex],s:to.s,f:to.f};

        const kind=S.pendingMove;
        const event={
          type:EVENT_TYPE.MOVE,
          movement:kind,
          chordMove:true,
          sourceChordId:ctx.chordId,
          chordId:ctx.chordId,
          movingNoteIndex:movingIndex,
          chordBefore:before,
          chordAfter:after,
          from,
          to:clonePos(to),
          durationUnits:SCORE_DEFAULT_DURATION_UNITS,
          play:true
        };

        if(kind===MOVEMENT_TYPE.BEND){
          if(releasingPriorBend){
            event.bendId=sourceEvent.bendId;
            event.bendPhase=BEND_PHASE.RELEASE;
            event.bendHome=clonePos(sourceEvent.bendHome);
          }else{
            event.bendId='bend-'+(S.nextBendId++);
            event.bendPhase=BEND_PHASE.UP;
            event.bendHome=clonePos(from);
          }
        }

        pushAuthorSnapshot();
        S.events.push(event);

        S.pendingMove=null;
        S.pendingPreBend=null;
        S.pendingChordMove=null;
        updateMoveButtons();
        propagateFingerAssignments();
        rebuildAuthor();

        // Audition only the moving voice; the held chord tones are not re-plucked.
        auditionDynamicNote(to.s,to.f,.20);

        const suffix=(kind===MOVEMENT_TYPE.BEND && event.bendPhase===BEND_PHASE.RELEASE)
          ? ' release'
          : '';
        announce(
          `${prettyMove(kind)}${suffix} in chord: ${noteName(from.s,from.f)} → ${noteName(to.s,to.f)}`,
          true
        );
        return;
      }

      const from=clonePos(S.author.currentOrigin);
      const fromEntry=currentFingerEntry();

      if(
        S.pendingMove==='bend' &&
        S.pendingPreBend &&
        S.pendingPreBend.sounding &&
        to.s===S.pendingPreBend.sounding.s &&
        to.f<S.pendingPreBend.sounding.f
      ){
        if(to.f<=0){
          announce('A pre-bend needs a fretted physical finger position.',false);
          return;
        }

        const sourceIndex=S.pendingPreBend.sourceEventIndex;
        const source=S.events[sourceIndex];

        if(!source || source.type!=='fingerOn'){
          clearPendingPreBend(true);
          announce('The original played note is no longer available for pre-bend conversion.',false);
          return;
        }

        const event={
          type:'move',
          movement:'bend',
          from:clonePos(S.pendingPreBend.sounding), // sounding phantom pitch
          to:clonePos(to),                         // physical/final fret
          bendId:'bend-'+(S.nextBendId++),
          bendPhase:'pre-release',
          bendHome:clonePos(to),
          durationUnits:eventDurationUnits(source),
          play:true
        };

        pushAuthorSnapshot();

        // Replace the original pluck rather than adding a second event.
        // This prevents playback from physically plucking the phantom fret.
        S.events[sourceIndex]=event;

        S.pendingMove=null;
        S.pendingPreBend=null;
        updateMoveButtons();
        rebuildAuthor();

        // Brief authoring audition: already-bent pitch is plucked, then relaxes.
        startPreBendReleaseArticulation(event);

        announce(
          `Pre-bend release: ${noteName(event.from.s,event.from.f)} → ${noteName(event.to.s,event.to.f)}`,
          true
        );
        return;
      }

      const err=validateMove(S.pendingMove,from,to,fromEntry);

      if(err){
        announce(err,false);
        return;
      }

      const kind=S.pendingMove;
      const event={
        type:'move',
        movement:kind,
        from,
        to,
        durationUnits:SCORE_DEFAULT_DURATION_UNITS,
        play:true
      };

      if(kind==='bend'){
        if(fromEntry && fromEntry.kind==='bendRing'){
          event.bendId=fromEntry.bendId;
          event.bendPhase='release';
          event.bendHome=clonePos(fromEntry.bendFrom);
        }else{
          event.bendId='bend-'+(S.nextBendId++);
          event.bendPhase='up';
          event.bendHome=clonePos(from);
        }
      }

      pushAuthorSnapshot();
      S.events.push(event);

      S.pendingMove=null;
      S.pendingPreBend=null;
      S.pendingChordMove=null;
      updateMoveButtons();
      rebuildAuthor();
      auditionDynamicNote(to.s,to.f,.20);

      const extra=(kind==='bend')
        ? (event.bendPhase==='up'?' (bend up)':' (release)')
        : '';
      announce(`${prettyMove(kind)}${extra}: ${noteName(from.s,from.f)} → ${noteName(s,f)}`,true);
      return;
    }

    if(S.author.fingers.has(k)){
      // Normal Played Notes construction mode: tapping an existing pink note
      // turns it off exactly as it did before the score/timing feature existed.
      pushAuthorSnapshot();
      S.events.push({type:'fingerOff',s,f,play:false});
      rebuildAuthor();
      playUiClick();
      announce(`Finger off: ${noteName(s,f)}. Sequence connection reset.`,false);
      return;
    }

    // No movement armed = ordinary pluck.
    pushAuthorSnapshot();
    S.events.push({
      type:'fingerOn',
      s,f,
      articulation:'pluck',
      durationUnits:SCORE_DEFAULT_DURATION_UNITS,
      play:true
    });
    rebuildAuthor();
    auditionDynamicNote(s,f,.20);
    announce(`Pluck: ${noteName(s,f)}`,true);
  }

  function insertRest(){
    if(document.body.classList.contains('player')) return;

    if(!scoreTimingActive()){
      statusEl.innerHTML=
        '<strong>Turn Score on first.</strong><br>Rests are added during the timing phase.';
      return;
    }

    if(S.fingeringAssign.active){
      cancelFingeringAssignment(false);
      S.tool='finger';
      updateAuthorModeUI();
    }

    if(S.tool!=='finger') setTool('finger');

    exitSequencePreview();
    resetPendingAuthoringState();

    /*
      Score Rest behavior:
      - no timing selection -> append at the end
      - selected note/chord/rest -> insert immediately after that event
      Preserve the pre-insertion selection in the Undo snapshot.
    */
    const selectedIndex=(
      S.editSelectionKind==='timing' &&
      Number.isInteger(S.editEventIndex) &&
      S.events[S.editEventIndex] &&
      isTimedEvent(S.events[S.editEventIndex])
    ) ? S.editEventIndex : null;

    pushAuthorSnapshot();

    const insertIndex=selectedIndex===null
      ? S.events.length
      : selectedIndex+1;

    S.events.splice(insertIndex,0,{
      type:EVENT_TYPE.REST,
      durationUnits:SCORE_DEFAULT_DURATION_UNITS,
      play:true
    });

    // The new rest immediately becomes the active score-timing item.
    S.previewEventIndex=null;
    S.editEventIndex=insertIndex;
    S.editSelectionKind='timing';

    silenceActiveGuitarSources(.02);
    rebuildAuthor();
    renderScore();

    requestAnimationFrame(()=>{
      scrollScoreToEvent(insertIndex,'smooth');
    });

    statusEl.innerHTML=
      `<strong>Quarter rest ${selectedIndex===null?'added':'inserted'}</strong><br>`+
      'The new rest is selected. Use − / + to change its duration.';
  }


  function prettyMove(kind){
    if(kind==='hammer-on') return 'Hammer-on';
    if(kind==='pull-off') return 'Pull-off';
    if(kind==='bend') return 'Bend';
    if(kind==='slide') return 'Slide';
    if(kind==='chord') return 'Chord';
    return kind;
  }

  function samePos(a,b){
    return !!(a && b && a.s===b.s && a.f===b.f);
  }

  function nextMovementFromTarget(target){
    if(!target) return null;

    for(let i=target.eventIndex+1;i<S.events.length;i++){
      const e=S.events[i];

      // Framework and edit-only events do not advance the performed phrase.
      if(e.type==='frameworkOn' || e.type==='frameworkOff' || e.play===false) continue;

      if(e.type==='move' && samePos(e.from,target.pos)){
        return e;
      }
      break;
    }
    return null;
  }

  function clearFingeringMovementCues(){
    shell.querySelectorAll('.fingerAssignCue').forEach(el=>el.remove());
  }

  function addFingeringMovementCue(pos,label){
    if(!pos || !label) return;
    const cue=document.createElement('div');
    cue.className='fingerAssignCue';
    cue.textContent=label;
    const p=shellPoint(pos.s,pos.f);
    cue.style.left=p.x+'px';
    cue.style.top=p.y+'px';
    cue.dataset.cueKey=`${pos.s}:${pos.f}:${label}`;
    shell.appendChild(cue);
  }

  function showFingeringMovementCues(target){
    clearFingeringMovementCues();
    if(!target) return;

    const seen=new Set();
    const add=(pos,label)=>{
      if(!pos || !label) return;
      const key=`${pos.s}:${pos.f}:${label}`;
      if(seen.has(key)) return;
      seen.add(key);
      addFingeringMovementCue(pos,label);
    };

    const event=S.events[target.eventIndex];

    // If the current assignment itself is the destination of a movement,
    // annotate according to the musical meaning of that movement.
    if(event && event.type==='move'){
      if(event.movement==='hammer-on') add(event.to,'H');
      if(event.movement==='pull-off') add(event.from,'P');
      if(event.movement==='slide') add(event.to,'S');
      if(event.movement==='bend'){
        if(event.bendPhase==='pre-release') add(event.bendHome || event.to,'B');
        else if(event.bendPhase!=='release') add(event.from,'B');
      }
    }

    // Also show the movement that follows the currently assigned origin note.
    const upcoming=nextMovementFromTarget(target);
    if(upcoming){
      if(upcoming.movement==='hammer-on') add(upcoming.to,'H');
      if(upcoming.movement==='pull-off') add(upcoming.from,'P');
      if(upcoming.movement==='slide') add(upcoming.to,'S');
      if(upcoming.movement==='bend'){
        if(upcoming.bendPhase==='pre-release') add(upcoming.bendHome || upcoming.to,'B');
        else if(upcoming.bendPhase!=='release') add(upcoming.from,'B');
      }
    }
  }

  function setAssignmentMarkPosition(pos,instant=false){
    if(!pos) return;
    const p=shellPoint(pos.s,pos.f);

    if(instant){
      fingerAssignMark.style.transition='none';
    }

    fingerAssignMark.classList.toggle('openPhantom',pos.f===0);
    applyPitchLabel(fingerAssignMark,pos.s,pos.f,'admin');
    fingerAssignMark.style.left=p.x+'px';
    fingerAssignMark.style.top=p.y+'px';

    if(instant){
      fingerAssignMark.getBoundingClientRect();
      fingerAssignMark.style.transition='';
    }
  }

  async function moveAssignmentMarkTo(pos,duration){
    if(!pos) return;

    const p=shellPoint(pos.s,pos.f);
    fingerAssignMark.style.transition=
      `left ${duration}ms cubic-bezier(.22,.72,.24,1),`+
      `top ${duration}ms cubic-bezier(.22,.72,.24,1)`;

    fingerAssignMark.style.left=p.x+'px';
    fingerAssignMark.style.top=p.y+'px';

    await sleep(duration);
    applyPitchLabel(fingerAssignMark,pos.s,pos.f,'admin');
  }

  async function moveAssignmentMarkToWithCue(
    pos,
    duration,
    cue,
    leadMs=duration
  ){
    if(!pos) return;

    const p=shellPoint(pos.s,pos.f);
    fingerAssignMark.style.transition=
      `left ${duration}ms cubic-bezier(.22,.72,.24,1),`+
      `top ${duration}ms cubic-bezier(.22,.72,.24,1)`;

    fingerAssignMark.style.left=p.x+'px';
    fingerAssignMark.style.top=p.y+'px';

    const lead=Math.max(0,Math.min(duration,leadMs));
    const beforeCue=Math.max(0,duration-lead);

    if(beforeCue>0) await sleep(beforeCue);
    if(typeof cue==='function') cue();

    if(lead>0) await sleep(lead);
    applyPitchLabel(fingerAssignMark,pos.s,pos.f,'admin');
  }

  async function bendAssignmentMark(e,duration){
    const home=e.bendHome || ((e.bendPhase==='release' || e.bendPhase==='pre-release')?e.to:e.from);
    if(!home) return;

    const X=stringXs();
    const start=shellPoint(home.s,home.f);
    const nextX=X[Math.min(5,home.s+1)];
    const semitones=Math.abs(e.to.f-e.from.f);
    const amount=Math.max(0,Math.min(1,semitones/2));

    if(e.bendPhase==='pre-release'){
      // It begins already bent, before the note is plucked.
      fingerAssignMark.style.transition='none';
      fingerAssignMark.style.left=(start.x+(nextX-start.x)*amount)+'px';
      fingerAssignMark.style.top=start.y+'px';
      fingerAssignMark.getBoundingClientRect();
    }

    const targetX=(e.bendPhase==='release' || e.bendPhase==='pre-release')
      ? start.x
      : start.x+(nextX-start.x)*amount;

    fingerAssignMark.style.transition=
      `left ${duration}ms cubic-bezier(.22,.72,.24,1),`+
      `top ${duration}ms cubic-bezier(.22,.72,.24,1)`;

    fingerAssignMark.style.left=targetX+'px';
    fingerAssignMark.style.top=start.y+'px';

    await sleep(duration);
  }

  function nextFingeringTargetAfter(target){
    if(!target || !S.fingeringAssign.active) return null;
    return S.fingeringAssign.targets[S.fingeringAssign.cursor+1] || null;
  }

  function inheritedAssignmentEventsAfter(target,nextTarget){
    if(!target) return [];

    const end=nextTarget ? nextTarget.eventIndex-1 : S.events.length-1;
    const out=[];

    for(let i=target.eventIndex+1;i<=end;i++){
      const e=S.events[i];

      if(e.type==='frameworkOn' || e.type==='frameworkOff' || e.play===false){
        continue;
      }

      // Everything between two fingering targets is already resolved:
      // - open-string plucks require no finger,
      // - pull-offs to open require no receiving finger,
      // - slides/bends inherit the prior finger,
      // - fingerOff changes sounding state but not hand location.
      //
      // Admin should therefore PLAY these events before asking for the next
      // unresolved finger assignment.
      out.push(e);
    }

    return out;
  }

  async function auditionAssignedTarget(target){
    if(!target) return;

    const e=S.events[target.eventIndex];
    const run=S.runId;

    // Make sure sampled guitar is ready while we are still inside the user's
    // finger-selection gesture.
    await unlockSampleAudio();

    if(e.type==='chord' && target.kind==='chord'){
      const note=e.notes[target.chordNoteIndex];

      drawChordAssignmentHand(e.notes,false);
      S.fingerPose=chordApproxFingerPose(e.notes);

      // During assignment, audition only the note whose finger was just
      // chosen. Player will sound the complete chord simultaneously.
      playStringSample(note.s,note.f,.20,.72);
      await sleep(250);
      return;
    }

    if(e.type==='fingerOn'){
      // The chosen finger physically takes the note and stays there.
      const finalPose=setFingerPoseForEvent(e);
      drawFingerPose(finalPose,false);

      // A normal pluck is heard immediately.
      playStringSample(e.s,e.f,.20,Math.max(.18,eventDurationMs(e)/1000*.92));
      await sleep(250);
      return;
    }

    if(e.type!=='move') return;

    if(e.movement==='hammer-on'){
      // Start the assignment cue at the sounding origin so the selected
      // articulation is actually demonstrated, then land on the destination.
      setAssignmentMarkPosition(e.from,true);

      const finalPose=setFingerPoseForEvent(e);
      drawFingerPose(finalPose,false);

      await moveAssignmentMarkToWithCue(
        e.to,
        205,
        ()=>playHammerOnArticulation(e)
      );
      if(run!==S.runId) return;
      await sleep(180);
      return;
    }

    if(e.movement==='bend' && e.bendPhase==='pre-release'){
      const finalPose=setFingerPoseForEvent(e);
      const prePose=preBentPoseFromFinal(finalPose,e);

      drawFingerPose(prePose,true);

      // Physical position stays at the lower fret; phantom ring is the
      // already-bent sounding pitch.
      setAssignmentMarkPosition(e.bendHome || e.to,true);
      makeMark(
        'fingerMark bendRing preBendPitchRing',
        e.from.s,
        e.from.f,
        positionLabel(e.from.s,e.from.f,'admin')
      );

      startPreBendReleaseArticulation(e);
      requestAnimationFrame(()=>drawFingerPose(finalPose,false));
      await bendAssignmentMark(e,460);
      if(run!==S.runId) return;
      await sleep(140);
      return;
    }

    if(e.movement==='pull-off'){
      const finalPose=setFingerPoseForEvent(e);
      const prepared=pullOffPreparedPose(e,finalPose);

      setAssignmentMarkPosition(e.from,true);
      drawFingerPose(prepared,false);
      await sleep(300);
      if(run!==S.runId) return;

      playPullOffRelease(e);
      drawFingerPose(finalPose,false);

      await sleep(55);
      if(run!==S.runId) return;

      await moveAssignmentMarkToWithCue(
        e.to,
        205,
        ()=>playPullOffResult(e)
      );
      if(run!==S.runId) return;
      await sleep(140);
      return;
    }

    // Slide and bend normally inherit fingering and therefore are auditioned
    // by auditionInheritedAssignmentEvent() below.
  }

  async function auditionInheritedAssignmentEvent(e){
    const run=S.runId;

    if(isChordMoveEvent(e)){
      const target=nextFingerPoseForEvent(S.fingerPose,e);
      S.fingerPose=target;
      drawFingerPose(target,false);

      if(e.movement===MOVEMENT_TYPE.SLIDE){
        await playSlideArticulation(e,run);
      }else if(e.movement===MOVEMENT_TYPE.BEND){
        if(e.bendPhase===BEND_PHASE.RELEASE) releaseBendArticulation(e);
        else startBendArticulation(e);
        await sleep(220);
      }
      return;
    }

    if(e.type==='fingerOff'){
      S.fingerPose=nextFingerPoseForEvent(S.fingerPose,e);
      drawFingerPose(S.fingerPose,false);
      await sleep(90);
      return;
    }

    if(e.type==='chord'){
      drawChordHand(e.notes || [],false);
      S.fingerPose=chordApproxFingerPose(e.notes || []);
      for(const note of e.notes || []){
        playStringSample(note.s,note.f,.20,.68);
      }
      await sleep(520);
      return;
    }

    if(e.type==='fingerOn'){
      // Open-string note: phantom sounding position only. Play it before the
      // next finger request and leave the hand at the last established
      // physical position.
      if(e.f===0){
        S.fingerPose=nextFingerPoseForEvent(S.fingerPose,e);
        drawFingerPose(S.fingerPose,false);

        setAssignmentMarkPosition({s:e.s,f:e.f},true);
        fingerAssignMark.classList.add('openPhantom');
        applyPitchLabel(fingerAssignMark,e.s,e.f,'admin');
        fingerAssignMark.style.display='flex';

        playStringSample(e.s,e.f,.20,.72);
        await sleep(520);
        if(run!==S.runId) return;
      }
      return;
    }

    if(e.type!=='move') return;

    if(e.movement==='hammer-on'){
      // Defensive support for any fingerless/open destination movement.
      setAssignmentMarkPosition(e.from,true);

      const finalPose=setFingerPoseForEvent(e);
      drawFingerPose(finalPose,false);

      await moveAssignmentMarkToWithCue(
        e.to,
        205,
        ()=>playHammerOnArticulation(e)
      );
      fingerAssignMark.classList.toggle('openPhantom',e.to.f===0);
      applyPitchLabel(fingerAssignMark,e.to.s,e.to.f,'admin');
      if(run!==S.runId) return;

      await sleep(180);
      return;
    }

    if(e.movement==='pull-off'){
      const finalPose=setFingerPoseForEvent(e);
      const prepared=pullOffPreparedPose(e,finalPose);

      setAssignmentMarkPosition(e.from,true);
      fingerAssignMark.classList.remove('openPhantom');
      drawFingerPose(prepared,false);
      await sleep(300);
      if(run!==S.runId) return;

      playPullOffRelease(e);
      drawFingerPose(finalPose,false);

      await sleep(55);
      if(run!==S.runId) return;

      await moveAssignmentMarkToWithCue(
        e.to,
        205,
        ()=>playPullOffResult(e)
      );
      fingerAssignMark.classList.toggle('openPhantom',e.to.f===0);
      applyPitchLabel(fingerAssignMark,e.to.s,e.to.f,'admin');
      if(run!==S.runId) return;

      await sleep(140);
      return;
    }

    if(e.movement==='slide'){
      setAssignmentMarkPosition(e.from,true);

      const finalPose=setFingerPoseForEvent(e);
      drawFingerPose(finalPose,false);

      const audioPromise=playSlideArticulation(e,run);
      await moveAssignmentMarkTo(e.to,460);
      await audioPromise;
      if(run!==S.runId) return;

      fingerAssignMark.classList.toggle('openPhantom',e.to.f===0);
      applyPitchLabel(fingerAssignMark,e.to.s,e.to.f,'admin');
      await sleep(120);
      return;
    }

    if(e.movement==='bend'){
      const finalPose=setFingerPoseForEvent(e);

      if(e.bendPhase==='pre-release'){
        const prePose=preBentPoseFromFinal(finalPose,e);
        drawFingerPose(prePose,true);
        setAssignmentMarkPosition(e.bendHome || e.to,true);
        makeMark(
          'fingerMark bendRing preBendPitchRing',
          e.from.s,
          e.from.f,
          positionLabel(e.from.s,e.from.f,'admin')
        );
        startPreBendReleaseArticulation(e);
        requestAnimationFrame(()=>drawFingerPose(finalPose,false));
      }else{
        drawFingerPose(finalPose,false);

        if(e.bendPhase==='release'){
          releaseBendArticulation(e);
        }else{
          startBendArticulation(e);
        }
      }

      await bendAssignmentMark(e,460);
      if(run!==S.runId) return;
      await sleep(100);
    }
  }

  function buildAssignedPoseThrough(eventIndex){
    const saved=S.fingerPose;
    S.fingerPose=blankFingerPose();

    for(let i=0;i<=eventIndex;i++){
      const e=S.events[i];

      if(e.type==='fingerOff'){
        S.fingerPose=restingPoseAtSameHandPosition(S.fingerPose);
        continue;
      }

      if(e.type==='fingerOn'){
        if(validFingerLetter(e.finger)) setFingerPoseForEvent(e);
        continue;
      }

      if(e.type==='chord'){
        S.fingerPose=chordApproxFingerPose(e.notes || []);
        continue;
      }

      if(e.type==='move'){
        if(validFingerLetter(e.finger)) setFingerPoseForEvent(e);
      }
    }

    const built=cloneFingerPose(S.fingerPose);
    S.fingerPose=saved;
    return built;
  }

  function assignmentChoicePose(target){
    const p=cloneFingerPose(S.fingerPose || blankFingerPose());

    // Once the hand has reached a physical position, that exact pose is the
    // starting point for the next assignment. Do NOT change activeString,
    // baseFret, or any held finger merely because the next target is elsewhere.
    if(hasEstablishedHandPosition(p)){
      return p;
    }

    // Only the first choice (or a choice after a true finger-off) needs a
    // neutral hand position placed around the target region.
    p.activeString=target.pos.s;
    p.baseFret=Math.max(1,Math.min(TOTAL_FRETS-3,target.pos.f-1));
    p.bendFinger=null;
    p.bendAmount=0;
    return p;
  }

  function fingeringTargetLabel(target){
    if(!target) return '';

    const upcoming=nextMovementFromTarget(target);
    if(upcoming){
      if(upcoming.movement==='bend' && upcoming.bendPhase==='release') return 'Bend release';
      return prettyMove(upcoming.movement);
    }

    if(target.kind==='chord') return 'Chord';
    if(target.kind==='pluck') return 'Pluck';
    if(target.kind==='hammer-on') return 'Hammer-on';
    if(target.kind==='pull-off') return 'Pull-off';
    if(target.kind==='slide') return 'Slide';
    if(target.kind==='bend') return 'Bend';
    if(target.kind==='bend-release') return 'Bend release';
    if(target.kind==='pre-bend') return 'Pre-bend release';
    return prettyMove(target.kind || '');
  }

  function fingeringTargets(){
    const targets=[];
    S.events.forEach((e,eventIndex)=>{
      if(e.play===false) return;

      if(e.type==='fingerOn'){
        if(e.f===0) return;

        targets.push({
          eventIndex,
          pos:{s:e.s,f:e.f},
          kind:'pluck'
        });
        return;
      }

      if(e.type==='chord'){
        const fretted=(e.notes || []).filter(note=>note.f>0);

        // A chord is ONE fingering stop. The user chooses the individual
        // chord member to assign, exactly as in the standalone prototype.
        if(fretted.length){
          targets.push({
            eventIndex,
            pos:{s:fretted[0].s,f:fretted[0].f},
            kind:'chord'
          });
        }
        return;
      }

      if(e.type==='move' && (e.movement==='hammer-on' || e.movement==='pull-off')){
        if(e.to && e.to.f===0) return;

        targets.push({
          eventIndex,
          pos:clonePos(e.to),
          kind:e.movement
        });
        return;
      }

      if(isPreBendEvent(e)){
        const physical=eventPhysicalPosition(e);
        if(physical && physical.f>0){
          targets.push({
            eventIndex,
            pos:physical,
            kind:'pre-bend'
          });
        }
      }
    });
    return targets;
  }

  function clearFingerAssignmentData(){
    for(const e of S.events){
      if(e.type==='fingerOn'){
        delete e.finger;
      }else if(e.type==='move'){
        delete e.finger;
        delete e.fromFinger;
        delete e.toFinger;
        if(isChordMoveEvent(e)){
          for(const list of [e.chordBefore,e.chordAfter]){
            for(const note of list || []) delete note.finger;
          }
        }
      }else if(e.type==='chord'){
        (e.notes || []).forEach(note=>delete note.finger);
      }
    }
  }

  function propagateFingerAssignments(){
    let currentFinger=null;
    let currentChordNotes=null;

    const cloneChordNotes=notes=>(notes || []).map(note=>({...note}));

    for(const e of S.events){
      if(e.type==='frameworkOn' || e.type==='frameworkOff') continue;

      if(e.type==='fingerOff'){
        currentFinger=null;
        currentChordNotes=null;
        continue;
      }

      if(e.type===EVENT_TYPE.REST){
        currentFinger=null;
        currentChordNotes=null;
        continue;
      }

      if(e.type==='chord'){
        currentFinger=null;
        currentChordNotes=cloneChordNotes(e.notes);
        continue;
      }

      if(isChordMoveEvent(e)){
        const before=currentChordNotes
          ? cloneChordNotes(currentChordNotes)
          : cloneChordNotes(e.chordBefore);

        const movingIndex=Number.isInteger(e.movingNoteIndex)
          ? e.movingNoteIndex
          : before.findIndex(note=>note.s===e.from.s);

        const sourceNote=movingIndex>=0 ? before[movingIndex] : null;
        const inherited=sourceNote && validFingerLetter(sourceNote.finger)
          ? fingerLetter(sourceNote.finger)
          : null;

        if(inherited) e.fromFinger=inherited;
        else delete e.fromFinger;

        if(e.movement===MOVEMENT_TYPE.SLIDE || e.movement===MOVEMENT_TYPE.BEND){
          if(inherited){
            e.finger=inherited;
            e.toFinger=inherited;
          }else{
            delete e.finger;
            delete e.toFinger;
          }
        }else if(e.movement===MOVEMENT_TYPE.HAMMER || e.movement===MOVEMENT_TYPE.PULL){
          if(e.to && e.to.f===0){
            delete e.toFinger;
            if(e.movement===MOVEMENT_TYPE.PULL && inherited) e.finger=inherited;
            else delete e.finger;
          }else{
            const assigned=validFingerLetter(e.finger)
              ? fingerLetter(e.finger)
              : null;
            if(assigned){
              e.finger=assigned;
              e.toFinger=assigned;
            }else{
              delete e.toFinger;
            }
          }
        }

        const after=cloneChordNotes(before);
        if(movingIndex>=0){
          const next={...after[movingIndex],s:e.to.s,f:e.to.f};

          if(e.to.f===0){
            delete next.finger;
          }else if(
            e.movement===MOVEMENT_TYPE.SLIDE ||
            e.movement===MOVEMENT_TYPE.BEND
          ){
            if(inherited) next.finger=inherited;
            else delete next.finger;
          }else if(validFingerLetter(e.toFinger)){
            next.finger=fingerLetter(e.toFinger);
          }else{
            delete next.finger;
          }

          after[movingIndex]=next;
        }

        // Keep snapshots synchronized with the canonical fingering data so
        // Player, score, open-position shifting, and later chord moves agree.
        e.chordBefore=cloneChordNotes(before);
        e.chordAfter=cloneChordNotes(after);

        currentChordNotes=after;
        currentFinger=null;
        continue;
      }

      currentChordNotes=null;

      if(e.type==='fingerOn'){
        if(e.f===0){
          delete e.finger;
          continue;
        }

        currentFinger=validFingerLetter(e.finger)?fingerLetter(e.finger):null;
        continue;
      }

      if(e.type!=='move') continue;

      const fromFinger=currentFinger;

      if(e.movement==='hammer-on' || e.movement==='pull-off'){
        if(fromFinger) e.fromFinger=fromFinger;
        else delete e.fromFinger;

        if(e.to && e.to.f===0){
          delete e.toFinger;
          if(e.movement==='pull-off' && fromFinger){
            e.finger=fromFinger;
          }else{
            delete e.finger;
          }
          currentFinger=null;
          continue;
        }

        const toFinger=validFingerLetter(e.finger)?fingerLetter(e.finger):null;

        if(toFinger){
          e.toFinger=toFinger;
          e.finger=toFinger;
          currentFinger=toFinger;
        }else{
          delete e.toFinger;
          currentFinger=null;
        }
        continue;
      }

      if(e.movement==='bend' && e.bendPhase==='pre-release'){
        const ownFinger=validFingerLetter(e.finger)?fingerLetter(e.finger):null;

        if(ownFinger){
          e.fromFinger=ownFinger;
          e.toFinger=ownFinger;
          currentFinger=ownFinger;
        }else{
          delete e.fromFinger;
          delete e.toFinger;
          currentFinger=null;
        }
        continue;
      }

      if(e.movement==='slide' || e.movement==='bend'){
        if(fromFinger){
          e.finger=fromFinger;
          e.fromFinger=fromFinger;
          e.toFinger=fromFinger;
          currentFinger=fromFinger;
        }else{
          delete e.finger;
          delete e.fromFinger;
          delete e.toFinger;
          currentFinger=null;
        }
      }
    }
  }


  function targetFingerValue(target){
    if(!target) return null;
    const e=S.events[target.eventIndex];
    if(!e) return null;
    return e.finger;
  }

  function chordFingeringComplete(e){
    return !!(
      e &&
      e.type===EVENT_TYPE.CHORD &&
      (e.notes || []).every(note=>
        note.f===0 || validFingerLetter(note.finger)
      )
    );
  }

  function fingeringTargetComplete(target){
    if(!target) return false;
    const e=S.events[target.eventIndex];
    if(!e) return false;

    if(target.kind==='chord'){
      return chordFingeringComplete(e);
    }

    return validFingerLetter(e.finger);
  }

  function firstIncompleteFingeringTargetIndex(targets){
    return (targets || []).findIndex(
      target=>!fingeringTargetComplete(target)
    );
  }

  function makeFingeringSnapshot(){
    return {
      events:cloneEvents(S.events),
      cursor:S.fingeringAssign.cursor,
      selectedChordNoteIndex:S.fingeringAssign.selectedChordNoteIndex,
      completedChordReviewEventIndex:S.fingeringAssign.completedChordReviewEventIndex
    };
  }

  function pushFingeringSnapshot(){
    S.fingeringAssign.assignmentHistory.push(makeFingeringSnapshot());
    if(S.fingeringAssign.assignmentHistory.length>100){
      S.fingeringAssign.assignmentHistory.shift();
    }
  }

  function restoreFingeringSnapshot(snapshot){
    if(!snapshot) return false;

    hideFingeringConfirmDialog();

    S.events=cloneEvents(snapshot.events);
    S.fingeringAssign.targets=fingeringTargets();
    S.fingeringAssign.cursor=Math.max(
      0,
      Math.min(
        S.fingeringAssign.targets.length-1,
        Number.isInteger(snapshot.cursor)?snapshot.cursor:0
      )
    );
    S.fingeringAssign.selectedChordNoteIndex=
      Number.isInteger(snapshot.selectedChordNoteIndex)
        ? snapshot.selectedChordNoteIndex
        : null;
    S.fingeringAssign.completedChordReviewEventIndex=
      Number.isInteger(snapshot.completedChordReviewEventIndex)
        ? snapshot.completedChordReviewEventIndex
        : null;
    S.fingeringAssign.confirmingChordEventIndex=null;

    S.fingerPose=blankFingerPose();
    renderEventList();
    prepareFingeringTargetPose(currentFingeringTarget());
    showFingeringTarget(false);
    auditionFingeringTarget(currentFingeringTarget());
    return true;
  }


  function prepareFingeringTargetPose(target){
    S.fingerPose=blankFingerPose();
    clearChordBarres();

    if(!target) return;

    const e=S.events[target.eventIndex];
    if(!e) return;

    // Chords are rendered directly by the validated chord hand engine.
    if(target.kind==='chord') return;

    // When revisiting an already assigned position, show its saved fingering
    // rather than pretending it is a brand-new choice.
    if(validFingerLetter(e.finger)){
      S.fingerPose=nextFingerPoseForEvent(blankFingerPose(),e);
      return;
    }

    S.fingerPose=assignmentChoicePose(target);
  }

  function fingeringTargetIndexForEvent(eventIndex){
    return S.fingeringAssign.targets.findIndex(
      target=>target.eventIndex===eventIndex
    );
  }

  function jumpToFingeringEvent(eventIndex){
    if(!S.fingeringAssign.active) return false;

    const targetIndex=fingeringTargetIndexForEvent(eventIndex);
    if(targetIndex<0){
      statusEl.innerHTML=
        '<strong>No independent fingering assignment here.</strong><br>'+
        'Choose a pluck, hammer/pull destination, or chord row.';
      return false;
    }

    hideFingeringConfirmDialog();
    S.fingeringAssign.cursor=targetIndex;
    S.fingeringAssign.selectedChordNoteIndex=null;
    S.fingeringAssign.completedChordReviewEventIndex=null;
    S.fingeringAssign.confirmingChordEventIndex=null;

    prepareFingeringTargetPose(currentFingeringTarget());
    showFingeringTarget(false);
    return true;
  }


  function authoredFingeringCompleteForPlayback(){
    let sawPhysicalFinger=false;

    for(const e of S.events){
      if(e.play===false) continue;

      if(e.type==='fingerOn'){
        if(e.f===0) continue;
        sawPhysicalFinger=true;
        if(!validFingerLetter(e.finger)) return false;
        continue;
      }

      if(e.type==='chord'){
        for(const note of e.notes || []){
          if(note.f===0) continue;
          sawPhysicalFinger=true;
          if(!validFingerLetter(note.finger)) return false;
        }
        continue;
      }

      if(e.type==='move'){
        if(e.movement==='hammer-on' || e.movement==='pull-off'){
          if(e.to && e.to.f===0) continue;
        }

        // A movement that physically uses a fretting finger must have one.
        if(
          e.movement==='hammer-on' ||
          e.movement==='pull-off' ||
          e.movement==='slide' ||
          e.movement==='bend'
        ){
          sawPhysicalFinger=true;
          if(!validFingerLetter(e.finger)) return false;
        }
      }
    }

    return sawPhysicalFinger;
  }

  function fingeringReady(){
    /*
      Canonicalize inherited movement fingering first. Chords intentionally
      break the single-note inheritance chain; all other movement data is then
      evaluated in its final authored form.
    */
    propagateFingerAssignments();
    return authoredFingeringCompleteForPlayback();
  }

  function renderAssignmentBackground(){
    clearOverlays();

    const frames=new Map();
    for(const e of S.events){
      if(e.type==='frameworkOn') frames.set(posKey(e.s,e.f),{s:e.s,f:e.f});
      if(e.type==='frameworkOff') frames.delete(posKey(e.s,e.f));
    }

    for(const p of frames.values()){
      makeMark(frameworkMarkClass(p),p.s,p.f,positionLabel(p.s,p.f,'admin'));
    }
  }

  function hideFingerAssignmentOverlay(){
    if(fingerAssignFlashTimer){
      clearTimeout(fingerAssignFlashTimer);
      fingerAssignFlashTimer=null;
    }
    fingerAssignMark.style.display='none';
    fingerAssignDestinationMark.style.display='none';
    fingerAssignPopup.style.display='none';
    clearFingeringMovementCues();
    fingerRects.forEach(el=>el.classList.remove('assignmentChosen'));
    document.body.classList.remove(
      'fingeringAssignMode',
      'chordSelectingNote',
      'chordChoosingFinger'
    );
    chordFingerHitGeometry=[];
    suppressChordFingerSyntheticClick=false;
    if(suppressChordFingerSyntheticClickTimer){
      clearTimeout(suppressChordFingerSyntheticClickTimer);
      suppressChordFingerSyntheticClickTimer=null;
    }
    eventPanel.querySelectorAll('.event').forEach(el=>el.classList.remove('selected'));
  }

  function currentFingeringTarget(){
    if(!S.fingeringAssign.active) return null;
    return S.fingeringAssign.targets[S.fingeringAssign.cursor] || null;
  }

  function selectedChordFingeringNote(){
    const target=currentFingeringTarget();
    if(!target || target.kind!=='chord') return null;

    const e=S.events[target.eventIndex];
    const i=S.fingeringAssign.selectedChordNoteIndex;

    if(!e || e.type!=='chord' || !Number.isInteger(i)) return null;
    return e.notes[i] || null;
  }

  function handleChordFingeringPositionTap(s,f){
    const target=currentFingeringTarget();
    if(!target || target.kind!=='chord') return false;

    const e=S.events[target.eventIndex];
    if(!e || e.type!=='chord') return false;

    const noteIndex=(e.notes || []).findIndex(note=>note.s===s && note.f===f);
    if(noteIndex<0){
      statusEl.innerHTML='<strong>Choose a chord note.</strong><br>Tap one of the displayed chord positions.';
      return true;
    }

    const note=e.notes[noteIndex];

    if(note.f===0){
      auditionPositions([note]);
      statusEl.innerHTML='<strong>Open string</strong><br>This is a phantom position and does not need a finger.';
      return true;
    }

    S.fingeringAssign.selectedChordNoteIndex=noteIndex;
    auditionPositions([note]);
    S.fingeringAssign.completedChordReviewEventIndex=null;
    S.fingeringAssign.confirmingChordEventIndex=null;

    // This pointer/click sequence belongs to NOTE selection only.
    // Ignore the synthetic click that may follow this pointerup after the
    // redraw has switched the app into chordChoosingFinger mode.
    suppressChordFingerSyntheticClick=true;
    if(suppressChordFingerSyntheticClickTimer){
      clearTimeout(suppressChordFingerSyntheticClickTimer);
    }
    suppressChordFingerSyntheticClickTimer=setTimeout(()=>{
      suppressChordFingerSyntheticClick=false;
      suppressChordFingerSyntheticClickTimer=null;
    },320);

    showFingeringTarget(false);
    return true;
  }

  function hideFingeringConfirmDialog(){
    fingeringConfirmDialog.classList.remove('on');
    fingeringConfirmDialog.setAttribute('aria-hidden','true');
    S.fingeringAssign.confirmingChordEventIndex=null;
  }

  function showFingeringConfirmDialog(target){
    if(!target || target.kind!=='chord') return;

    S.fingeringAssign.confirmingChordEventIndex=target.eventIndex;
    fingeringConfirmDialog.classList.add('on');
    fingeringConfirmDialog.setAttribute('aria-hidden','false');
  }

  async function continueAfterConfirmedChord(){
    const target=currentFingeringTarget();
    if(
      !target ||
      target.kind!=='chord' ||
      S.fingeringAssign.confirmingChordEventIndex!==target.eventIndex
    ){
      hideFingeringConfirmDialog();
      return;
    }

    hideFingeringConfirmDialog();

    /*
      Confirmation is the explicit hand-state boundary requested by the user.
      The chord's assignments remain stored, but the physical assignment hand
      returns to its normal starting posture before anything later is shown.
    */
    S.fingerPose=blankFingerPose();
    clearChordBarres();

    const nextTarget=nextFingeringTargetAfter(target);

    if(!nextTarget){
      finishFingeringAssignment();
      return;
    }

    const inherited=inheritedAssignmentEventsAfter(target,nextTarget);
    for(const e of inherited){
      await auditionInheritedAssignmentEvent(e);
      if(!S.fingeringAssign.active) return;
    }

    S.fingerPose=blankFingerPose();
    clearChordBarres();
    S.fingeringAssign.cursor++;
    S.fingeringAssign.selectedChordNoteIndex=null;
    S.fingeringAssign.completedChordReviewEventIndex=null;

    prepareFingeringTargetPose(currentFingeringTarget());
    showFingeringTarget(false);
  }

  function keepEditingConfirmedChord(){
    const target=currentFingeringTarget();
    hideFingeringConfirmDialog();

    if(!target || target.kind!=='chord') return;

    S.fingeringAssign.selectedChordNoteIndex=null;
    S.fingeringAssign.completedChordReviewEventIndex=null;
    S.fingerPose=blankFingerPose();

    // Show the completed saved chord hand so it can be inspected or edited.
    showFingeringTarget(false);
    statusEl.innerHTML=
      '<strong>Chord fingering retained for editing</strong><br>'+
      'Tap a chord note to change it, use Undo, or select Continue by completing the chord again.';
  }

  function showFingeringTarget(repeatPosition=false){
    const target=currentFingeringTarget();
    if(!target){
      finishFingeringAssignment();
      return;
    }

    renderAssignmentBackground();

    const targetEvent=S.events[target.eventIndex];

    if(fingerAssignFlashTimer){
      clearTimeout(fingerAssignFlashTimer);
      fingerAssignFlashTimer=null;
    }

    fingerAssignDestinationMark.style.display='none';
    fingerAssignPopup.style.display='none';
    fingerRects.forEach(el=>el.classList.remove('assignmentChosen'));

    document.body.classList.add('fingeringAssignMode');
    document.body.classList.remove('chordSelectingNote','chordChoosingFinger');

    // A fresh chord assignment draw below rebuilds this map. For ordinary
    // fingering targets, ensure no stale chord geometry remains active.
    if(target.kind!=='chord') chordFingerHitGeometry=[];

    if(target.kind==='chord' && targetEvent && targetEvent.type==='chord'){
      const selectedIndex=S.fingeringAssign.selectedChordNoteIndex;

      // The chord remains a complete visible hand state. Just like the
      // standalone prototype:
      //   unassigned fretted note = green
      //   assigned fretted note = pink
      //   open string = pink phantom ring
      //   selected note = white outline
      for(let i=0;i<targetEvent.notes.length;i++){
        const note=targetEvent.notes[i];
        const assigned=note.f===0 || validFingerLetter(note.finger);

        let cls;
        if(note.f===0){
          cls=fingerMarkClass(note);
        }else if(assigned){
          cls=fingerMarkClass(note);
        }else{
          cls='fingerMark chordUnassigned';
        }

        if(i===selectedIndex) cls+=' chordSelected';

        makeMark(
          cls,
          note.s,
          note.f,
          positionLabel(note.s,note.f,'admin')
        );
      }

      // The old single-target pink assignment dot is intentionally not used
      // for chords. The user chooses the target directly on the fretboard.
      fingerAssignMark.style.display='none';
      clearFingeringMovementCues();

      drawChordAssignmentHand(targetEvent.notes,false);
      S.fingerPose=chordApproxFingerPose(targetEvent.notes);

      const selected=selectedChordFingeringNote();
      if(selected){
        document.body.classList.add('chordChoosingFinger');
        statusEl.innerHTML=
          `<strong>${noteName(selected.s,selected.f)} selected</strong><br>`+
          'Now tap the finger you want to assign.';
      }else{
        document.body.classList.add('chordSelectingNote');

        const remaining=(targetEvent.notes || []).filter(note=>
          note.f>0 && !validFingerLetter(note.finger)
        ).length;

        if(remaining===0){
          statusEl.innerHTML=
            '<strong>Chord fingering complete</strong><br>'+
            'Saved fingering is shown. Tap any chord note to edit it, or select another sequence row.';
        }else{
          statusEl.innerHTML=
            `<strong>Chord fingering</strong><br>`+
            `Tap the chord position you want to assign, then tap a finger. `+
            `${remaining} fretted position${remaining===1?'':'s'} remaining.`;
        }
      }

    }else{
      // Existing single-note/movement workflow is unchanged.
      const p=shellPoint(target.pos.s,target.pos.f);
      applyPitchLabel(fingerAssignMark,target.pos.s,target.pos.f,'admin');
      fingerAssignMark.classList.toggle('openPhantom',target.pos.f===0);
      fingerAssignMark.style.left=p.x+'px';
      fingerAssignMark.style.top=p.y+'px';

      if(repeatPosition){
        fingerAssignMark.style.display='none';
        fingerAssignFlashTimer=setTimeout(()=>{
          if(!S.fingeringAssign.active) return;
          const nowTarget=currentFingeringTarget();
          if(!nowTarget) return;
          if(nowTarget.pos.s!==target.pos.s || nowTarget.pos.f!==target.pos.f) return;
          fingerAssignMark.style.display='flex';
          fingerAssignFlashTimer=null;
        },150);
      }else{
        fingerAssignMark.style.display='flex';
      }

      showFingeringMovementCues(target);

      if(
        target.kind==='pre-bend' &&
        targetEvent &&
        targetEvent.type==='move' &&
        targetEvent.from
      ){
        makeMark(
          'fingerMark bendRing preBendPitchRing',
          targetEvent.from.s,
          targetEvent.from.f,
          positionLabel(targetEvent.from.s,targetEvent.from.f,'admin')
        );
      }

      clearChordBarres();
      if(!hasEstablishedHandPosition(S.fingerPose)){
        S.fingerPose=assignmentChoicePose(target);
      }
      drawFingerPose(S.fingerPose,false);
    }

    eventPanel.querySelectorAll('.event').forEach(el=>el.classList.remove('selected'));
    const row=eventPanel.querySelector(`.event[data-original-index="${target.eventIndex}"]`);
    if(row){
      row.classList.add('selected');
      row.scrollIntoView({block:'nearest'});
    }
  }

  function finishFingeringAssignment(){
    if(!S.fingeringAssign.active) return;

    hideFingeringConfirmDialog();
    propagateFingerAssignments();
    S.fingeringAssign.active=false;
    S.fingeringAssign.targets=[];
    S.fingeringAssign.cursor=0;
    S.fingeringAssign.selectedChordNoteIndex=null;
    S.fingeringAssign.assignmentHistory=[];
    S.fingeringAssign.completedChordReviewEventIndex=null;
    S.fingeringAssign.confirmingChordEventIndex=null;

    updateAuthorModeUI();
    hideFingerAssignmentOverlay();
    S.fingerPose=blankFingerPose();
    clearChordBarres();
    drawFingerPose(S.fingerPose,true);
    renderEventList();

    // End with no assignment-pink showing, as requested.
    renderAssignmentBackground();
  }

  function cancelFingeringAssignment(render=true){
    if(!S.fingeringAssign.active) return;

    S.fingeringAssign.active=false;
    S.fingeringAssign.targets=[];
    S.fingeringAssign.cursor=0;
    S.fingeringAssign.selectedChordNoteIndex=null;
    S.fingeringAssign.assignmentHistory=[];
    S.fingeringAssign.completedChordReviewEventIndex=null;
    S.fingeringAssign.confirmingChordEventIndex=null;
    hideFingeringConfirmDialog();
    document.body.classList.remove('chordSelectingNote','chordChoosingFinger');
    updateAuthorModeUI();
    hideFingerAssignmentOverlay();
    S.fingerPose=blankFingerPose();
    clearChordBarres();
    drawFingerPose(S.fingerPose,true);

    if(render) renderAuthor();
  }

  async function startFingeringAssignment(){
    exitSequencePreview();
    hideFingeringConfirmDialog();

    // Historical Framework/Played Notes editing ends when Fingering becomes
    // the active mode. The underlying stored events are unchanged.
    S.editEventIndex=null;
    S.editSelectionKind=null;
    S.previewEventIndex=null;

    resetPendingAuthoringState();

    propagateFingerAssignments();

    const targets=fingeringTargets();

    /*
      Mode cycling is unconditional. Fingering is still a valid authoring mode
      even when the clip currently has no fretted fingering targets. This is
      important because the single Mode button must always be able to continue
      on to Framework.
    */
    if(!targets.length){
      S.editEventIndex=null;
      S.editSelectionKind=null;
      S.previewEventIndex=null;

      S.fingeringAssign.active=true;
      S.fingeringAssign.targets=[];
      S.fingeringAssign.cursor=0;
      S.fingeringAssign.selectedChordNoteIndex=null;
      S.fingeringAssign.assignmentHistory=[];
      S.fingeringAssign.completedChordReviewEventIndex=null;
      S.fingeringAssign.confirmingChordEventIndex=null;

      document.body.classList.add('fingeringAssignMode');
      updateAuthorModeUI();
      renderAuthor();
      renderEventList();
      clearChordBarres();
      S.fingerPose=blankFingerPose();
      drawFingerPose(S.fingerPose,true);

      statusEl.innerHTML=
        '<strong>Fingering</strong><br>No fingering assignments yet. '+
        'Tap the Mode button again to continue to Framework.';
      return;
    }

    /*
      Fingering is persistent clip data. Re-entering this mode MUST NOT clear
      anything that has already been assigned.
    */
    const firstIncomplete=firstIncompleteFingeringTargetIndex(targets);
    const initialCursor=
      firstIncomplete>=0
        ? firstIncomplete
        : targets.length-1;

    S.fingeringAssign.active=true;
    S.fingeringAssign.targets=targets;
    S.fingeringAssign.cursor=initialCursor;
    S.fingeringAssign.selectedChordNoteIndex=null;
    S.fingeringAssign.assignmentHistory=[];
    S.fingeringAssign.completedChordReviewEventIndex=null;
    S.fingeringAssign.confirmingChordEventIndex=null;

    document.body.classList.add('fingeringAssignMode');
    updateAuthorModeUI();

    renderEventList();

    const target=currentFingeringTarget();
    prepareFingeringTargetPose(target);

    /*
      Preserve the useful open-string pre-roll only when starting at the first
      fingering target. When resuming an already-partially-fingered clip later
      in the sequence, jump directly to the unfinished position.
    */
    if(initialCursor===0){
      for(let i=0;i<target.eventIndex;i++){
        const e=S.events[i];

        if(e.type==='frameworkOn' || e.type==='frameworkOff' || e.play===false){
          continue;
        }

        await auditionInheritedAssignmentEvent(e);
        if(!S.fingeringAssign.active) return;
      }

      // Leading resolved events must not displace the intended fresh starting
      // posture for the actual assignment target.
      prepareFingeringTargetPose(target);
    }

    showFingeringTarget(false);
    auditionFingeringTarget(currentFingeringTarget());

    if(firstIncomplete<0){
      statusEl.innerHTML=
        '<strong>Fingering complete</strong><br>'+
        'Opened at the final fingering event. Use the sequence list to jump to any saved assignment.';
    }
  }

  async function chooseAssignedFinger(letter){
    const target=currentFingeringTarget();
    if(!target) return;

    const e=S.events[target.eventIndex];

    if(target.kind==='chord'){
      const noteIndex=S.fingeringAssign.selectedChordNoteIndex;

      if(!Number.isInteger(noteIndex)){
        statusEl.innerHTML=
          '<strong>Choose a chord position first.</strong><br>'+
          'Tap the note on the fretboard, then tap the finger.';
        return;
      }

      const note=e.notes[noteIndex];
      if(!note || note.f===0){
        statusEl.innerHTML=
          '<strong>Open strings need no finger.</strong><br>'+
          'Choose a fretted chord position.';
        return;
      }

      // Same finger may cover multiple notes only as one same-fret barre.
      const conflict=(e.notes || []).some((other,i)=>
        i!==noteIndex &&
        other.f>0 &&
        validFingerLetter(other.finger) &&
        fingerIndex(other.finger)===fingerIndex(letter) &&
        other.f!==note.f
      );

      if(conflict){
        statusEl.innerHTML=
          '<strong>Finger already used on another fret.</strong><br>'+
          'The same finger can cover multiple chord notes only when they form a barre on one fret.';
        return;
      }

      pushFingeringSnapshot();

      note.finger=letter;
      propagateFingerAssignments();

      const chosenIndex=fingerIndex(letter);
      fingerRects.forEach((el,i)=>
        el.classList.toggle('assignmentChosen',i===chosenIndex)
      );

      // Audition the particular note just assigned, but draw the entire chord
      // hand with the validated geometry engine.
      const actionTarget={
        ...target,
        chordNoteIndex:noteIndex,
        pos:{s:note.s,f:note.f}
      };

      await auditionAssignedTarget(actionTarget);
      if(!S.fingeringAssign.active) return;

      renderEventList();

      if(!chordFingeringComplete(e)){
        // Stay on this chord. No automatic choice of the next note:
        // the user decides which chord member to assign next.
        S.fingeringAssign.selectedChordNoteIndex=null;
        showFingeringTarget(false);
        return;
      }

      // The chord is fully assigned. Keep the complete hand on screen
      // and require explicit confirmation before proceeding.
      S.fingeringAssign.selectedChordNoteIndex=null;
      S.fingeringAssign.completedChordReviewEventIndex=null;
      renderEventList();
      showFingeringTarget(false);
      showFingeringConfirmDialog(target);
      return;
    }

    // Existing single-note/movement assignment behavior.
    pushFingeringSnapshot();

    e.finger=letter;

    propagateFingerAssignments();

    const chosenIndex=fingerIndex(letter);
    fingerRects.forEach((el,i)=>
      el.classList.toggle('assignmentChosen',i===chosenIndex)
    );

    const nextTarget=nextFingeringTargetAfter(target);

    await auditionAssignedTarget(target);
    if(!S.fingeringAssign.active) return;

    const inherited=inheritedAssignmentEventsAfter(target,nextTarget);
    for(const move of inherited){
      await auditionInheritedAssignmentEvent(move);
      if(!S.fingeringAssign.active) return;
    }

    const priorPos=clonePos(target.pos);

    S.fingeringAssign.cursor++;
    renderEventList();

    if(S.fingeringAssign.cursor>=S.fingeringAssign.targets.length){
      finishFingeringAssignment();
      return;
    }

    const upcoming=currentFingeringTarget();
    const repeatPosition=!!(
      upcoming &&
      upcoming.pos.s===priorPos.s &&
      upcoming.pos.f===priorPos.f
    );

    showFingeringTarget(repeatPosition);
  }

  function fingerSuffix(e){
    const f=fingerLetter(e.finger);
    return f?` [${f}]`:'';
  }

  function initialPlayerFrameworkState(){
    const st=blankState();

    // Show the framework that exists at the beginning of the lesson before
    // the first timed Dynamic/Movement event. Later framework changes still
    // occur at their authored positions during playback.
    for(const e of S.events){
      if(isTimedEvent(e)) break;
      if(e.type==='frameworkOn' || e.type==='frameworkOff'){
        applyEventInstant(st,e);
      }
    }

    return st;
  }

  const PLAYBACK_HAND_ANCHOR_MODE='assignment-equivalent';

  function initialAssignedRestPoseForPlayback(){
    const p=blankFingerPose();

    for(const e of S.events){
      if(e.type==='fingerOn' && e.f>0 && validFingerLetter(e.finger)){
        const fi=fingerIndex(e.finger);
        p.baseFret=clampFingerBase(e.f,fi);
        p.activeString=e.s;
        return p;
      }

      if(e.type==='chord'){
        const layout=computeChordHandLayout(e.notes || []);
        const fretted=(e.notes || []).filter(n=>n.f>0 && validFingerLetter(n.finger));
        if(fretted.length){
          p.baseFret=layout.baseFret;
          p.activeString=fretted[fretted.length-1].s;
          return p;
        }
      }

      if(
        isMoveEvent(e) &&
        validFingerLetter(e.finger)
      ){
        const physical=eventPhysicalPosition(e);
        if(!physical || physical.f<=0) continue;

        const fi=fingerIndex(e.finger);
        p.baseFret=clampFingerBase(physical.f,fi);
        p.activeString=physical.s;
        return p;
      }
    }

    return p;
  }

  function playerEventLabel(e){
    if(e.type===EVENT_TYPE.REST) return 'Rest';
    if(e.type==='fingerOn') return noteName(e.s,e.f);
    if(e.type==='chord') return (e.notes || []).map(n=>noteName(n.s,n.f)).join(' · ');
    if(e.type==='move' && e.to){
      if(e.movement==='bend' && e.bendPhase==='pre-release' && e.from){
        return noteName(e.from.s,e.from.f);
      }
      return noteName(e.to.s,e.to.f);
    }
    return '';
  }

  function describe(e){
    if(e.type===EVENT_TYPE.REST) return `Rest · ${durationSymbolForEvent(e)}`;
    if(e.type==='frameworkOn') return `Frame + ${noteName(e.s,e.f)}`;
    if(e.type==='frameworkOff') return `Frame − ${noteName(e.s,e.f)}`;
    if(e.type==='fingerOn') return `Pluck ${noteName(e.s,e.f)}${fingerSuffix(e)} · ${durationSymbolForEvent(e)}`;
    if(e.type==='chord'){
      const names=(e.notes || []).map(n=>{
        const f=fingerLetter(n.finger);
        return `${noteName(n.s,n.f)}${f?` [${f}]`:''}`;
      });
      return `Chord ${names.join(' · ')} · ${durationSymbolForEvent(e)}`;
    }
    if(e.type==='move'){
      if(e.movement==='bend' && e.bendPhase==='pre-release'){
        return `Pre-bend release ${noteName(e.from.s,e.from.f)}→${noteName(e.to.s,e.to.f)}${fingerSuffix(e)} · ${durationSymbolForEvent(e)}`;
      }
      const suffix=(e.movement==='bend' && e.bendPhase==='release')?' release':'';
      return `${prettyMove(e.movement)}${suffix} ${noteName(e.from.s,e.from.f)}→${noteName(e.to.s,e.to.f)}${fingerSuffix(e)} · ${durationSymbolForEvent(e)}`;
    }
    return e.type;
  }

  const SCORE_NS='http://www.w3.org/2000/svg';
  const SCORE_LEFT=94;
  const SCORE_UNIT_PX=22;
  const SCORE_MEASURE_PX=SCORE_UNITS_PER_MEASURE*SCORE_UNIT_PX;
  const SCORE_HEIGHT=132;
  const SCORE_LINE_YS=[44,54,64,74,84];
  const SCORE_BOTTOM_LINE_Y=84;
  const SCORE_HALF_STEP_Y=5;

  // Standard guitar notation:
  // - written treble clef is one octave above sounding pitch
  // - tolerate up to four ledger lines above the staff
  // - beyond that, display the passage one octave lower under an 8va bracket
  const SCORE_MAX_LEDGER_LINES_ABOVE=4;
  const SCORE_8VA_DIATONIC_STEPS=7;
  const SCORE_8VA_Y_SHIFT=SCORE_8VA_DIATONIC_STEPS*SCORE_HALF_STEP_Y;

  function scoreEl(tag,attrs={},text=null){
    const el=document.createElementNS(SCORE_NS,tag);
    for(const [k,v] of Object.entries(attrs)){
      el.setAttribute(k,String(v));
    }
    if(text!==null) el.textContent=text;
    return el;
  }

  function scoreWrittenMidi(pos){
    return midiAt(pos.s,pos.f)+12;
  }

  function scoreDiatonicStep(pos){
    const midi=scoreWrittenMidi(pos);
    const pc=mod12(midi);
    const letterByPc=[0,0,1,1,2,3,3,4,4,5,5,6];
    const octave=Math.floor(midi/12)-1;
    return octave*7+letterByPc[pc];
  }

  function scoreYForPosition(pos){
    const bottomE4Step=4*7+2;
    const delta=scoreDiatonicStep(pos)-bottomE4Step;
    return SCORE_BOTTOM_LINE_Y-delta*SCORE_HALF_STEP_Y;
  }

  function score8vaThresholdY(){
    return SCORE_LINE_YS[0]-(SCORE_MAX_LEDGER_LINES_ABOVE*10);
  }

  function scorePositionNeeds8va(pos){
    return !!(pos && scoreYForPosition(pos)<score8vaThresholdY());
  }

  function scoreEventUses8va(e){
    if(!e || e.type===EVENT_TYPE.REST) return false;
    return eventScorePositions(e).some(scorePositionNeeds8va);
  }

  function scoreDisplayYForPosition(pos,use8va=false){
    const raw=scoreYForPosition(pos);
    return use8va ? raw+SCORE_8VA_Y_SHIFT : raw;
  }

  function splitDurationAcrossMeasures(startUnit,durationUnits){
    const fragments=[];
    let remaining=durationUnits;
    let cursor=startUnit;

    while(remaining>0){
      const inMeasure=cursor%SCORE_UNITS_PER_MEASURE;
      const room=SCORE_UNITS_PER_MEASURE-inMeasure;
      let segment=Math.min(remaining,room);

      // Decompose a within-measure segment into standard notatable values.
      for(const value of [16,12,8,6,4,3,2,1]){
        while(segment>=value){
          fragments.push({
            startUnit:cursor,
            units:value,
            continuation:cursor!==startUnit
          });
          cursor+=value;
          remaining-=value;
          segment-=value;
        }
      }
    }

    return fragments;
  }

  function scoreMovementTag(e){
    if(!isMoveEvent(e)) return '';
    if(isPreBendEvent(e)) return 'PB';
    if(e.movement===MOVEMENT_TYPE.HAMMER) return 'H';
    if(e.movement===MOVEMENT_TYPE.PULL) return 'P';
    if(e.movement===MOVEMENT_TYPE.SLIDE) return 'S';
    if(e.movement===MOVEMENT_TYPE.BEND) return 'B';
    return '';
  }

  function drawScoreLedgerLines(group,x,y){
    const top=SCORE_LINE_YS[0];
    const bottom=SCORE_LINE_YS[SCORE_LINE_YS.length-1];

    if(y>bottom+1){
      for(let ly=bottom+10;ly<=y+1;ly+=10){
        group.appendChild(scoreEl('line',{
          x1:x-12,y1:ly,x2:x+12,y2:ly,
          stroke:'#111','stroke-width':1.2
        }));
      }
    }else if(y<top-1){
      for(let ly=top-10;ly>=y-1;ly-=10){
        group.appendChild(scoreEl('line',{
          x1:x-9,y1:ly,x2:x+9,y2:ly,
          stroke:'#111','stroke-width':1.2
        }));
      }
    }
  }

  function drawScoreNoteHead(group,x,y,meta,selected=false){
    drawScoreLedgerLines(group,x,y);

    // A pink halo is invisible normally and appears only for the selected
    // timing event (or currently playing event via CSS).
    group.appendChild(scoreEl('ellipse',{
      cx:x,cy:y,rx:10.5,ry:8.0,
      class:'scoreNoteHalo',
      transform:`rotate(-18 ${x} ${y})`
    }));

    const head=scoreEl('ellipse',{
      cx:x,cy:y,rx:7.0,ry:5.0,
      class:meta.filled?'scoreNoteFilled':'scoreNoteOpen',
      transform:`rotate(-18 ${x} ${y})`
    });
    group.appendChild(head);

    if(meta.stem){
      const stemUp=y>=64;
      const stemX=stemUp?x+6.5:x-6.5;
      const stemY2=stemUp?y-31:y+31;

      group.appendChild(scoreEl('line',{
        x1:stemX,y1:y,x2:stemX,y2:stemY2,
        class:'scoreNoteStroke'
      }));

      if(meta.flags){
        for(let i=0;i<meta.flags;i++){
          const y0=stemY2+(stemUp?i*5:-i*5);
          const d=stemUp
            ? `M ${stemX} ${y0} q 9 3 6 11`
            : `M ${stemX} ${y0} q -9 -3 -6 -11`;
          group.appendChild(scoreEl('path',{
            d,class:'scoreNoteFlag'
          }));
        }
      }
    }

    if(meta.dotted){
      group.appendChild(scoreEl('circle',{
        cx:x+13,cy:y-1,r:2.0,class:'scoreNoteDot'
      }));
    }
  }

  const STANDARD_REST_PATHS=Object.freeze({
    // Engraved quarter/eighth/sixteenth rest outlines embedded as SVG paths.
    // These are rendered as vector geometry, so appearance is independent
    // of which music fonts happen to be installed on the device.
    quarter:'M147 878 307 683Q257 624 230 581Q203 538 203 494Q203 457 227 416.5Q251 376 303 314L287 292Q243 320 205 320Q177 320 163 301.5Q149 283 149 257Q149 225 162.5 196.5Q176 168 199 142L186 123Q117 173 84 214Q51 255 51 303Q51 346 78 366Q105 386 143 386Q173 386 221 363V365L67 570Q168 659 168 736Q168 797 104 878Z',
    eighth:'M155 269 251 609Q230 590 203.5 582Q177 574 151 574Q108 574 79 597Q50 620 50 663Q50 691 70 710.5Q90 730 121 730Q150 730 168.5 711.5Q187 693 187 662Q187 640 177 623Q177 617 189 617Q244 617 294 703H312L191 269Z',
    sixteenth:'M155 147 251 487Q230 468 203.5 460Q177 452 151 452Q108 452 79 475Q50 498 50 541Q50 569 69.5 588.5Q89 608 121 608Q150 608 168.5 589.5Q187 571 187 540Q187 518 177 501Q177 495 189 495Q230 495 267 541L319 731Q298 712 271.5 704Q245 696 219 696Q176 696 147 719Q118 742 118 785Q118 813 138 832.5Q158 852 189 852Q219 852 237 833Q255 814 255 784Q255 774 252 763.5Q249 753 245 745Q245 739 257 739Q312 739 362 825H380L191 147Z'
  });

  function appendStandardRestGlyph(group,x,kind,ink='#111'){
    let path=STANDARD_REST_PATHS[kind];
    if(!path) return;

    let scale=1;
    let centerX=0;
    let translateY=0;

    if(kind==='quarter'){
      scale=0.0503;
      centerX=179;
      translateY=91.2;
    }else if(kind==='eighth'){
      scale=0.0694;
      centerX=181;
      translateY=99.7;
    }else{
      scale=0.0567;
      centerX=215;
      translateY=92.3;
    }

    const translateX=x-(centerX*scale);

    group.appendChild(scoreEl('path',{
      d:path,
      fill:ink,
      stroke:'none',
      transform:`translate(${translateX} ${translateY}) scale(${scale} ${-scale})`
    }));
  }

  function drawScoreRest(group,x,units,selected=false){
    const meta=durationMeta(units);
    const ink='#111';
    const base=meta.dotted ? (
      units===3 ? 2 :
      units===6 ? 4 :
      units===12 ? 8 :
      units
    ) : units;

    if(base===16){
      // Whole rest: hangs from the second staff line from the top.
      // Slight horizontal overhang gives it the normal engraved proportion.
      group.appendChild(scoreEl('rect',{
        x:x-8.5,
        y:54,
        width:17,
        height:6.5,
        rx:.4,
        fill:ink
      }));
    }else if(base===8){
      // Half rest: sits on the middle staff line.
      group.appendChild(scoreEl('rect',{
        x:x-8.5,
        y:57.5,
        width:17,
        height:6.5,
        rx:.4,
        fill:ink
      }));
    }else if(base===4){
      appendStandardRestGlyph(group,x,'quarter',ink);
    }else if(base===2){
      appendStandardRestGlyph(group,x,'eighth',ink);
    }else{
      // Internal sixteenth fragment used if a duration is split at a barline.
      appendStandardRestGlyph(group,x,'sixteenth',ink);
    }

    if(meta.dotted){
      group.appendChild(scoreEl('circle',{
        cx:x+13.5,
        cy:64,
        r:1.8,
        fill:ink
      }));
    }
  }

  function eventScorePositions(e){
    if(!e) return [];
    if(e.type===EVENT_TYPE.REST) return [];
    if(e.type===EVENT_TYPE.CHORD) return (e.notes || []).map(clonePos).filter(Boolean);
    if(isChordMoveEvent(e)) return (e.chordAfter || []).map(clonePos).filter(Boolean);

    const p=eventSoundingPosition(e);
    return p ? [p] : [];
  }

  function drawScoreEventFragment(group,e,frag,x,selected=false,use8va=false){
    const meta=durationMeta(frag.units);

    if(e.type===EVENT_TYPE.REST){
      drawScoreRest(group,x,frag.units,selected);
      return;
    }

    const positions=eventScorePositions(e);
    for(const pos of positions){
      drawScoreNoteHead(group,x,scoreDisplayYForPosition(pos,use8va),meta,selected);
    }

    if(!frag.continuation){
      const tag=scoreMovementTag(e);
      if(tag){
        group.appendChild(scoreEl('text',{
          x:x,y:22,'text-anchor':'middle',class:'scoreMoveTag'
        },tag));
      }
    }
  }

  function updateDurationEditor(){
    const e=selectedAuthorEditEvent();
    const enabled=!!(
      scoreTimingActive() &&
      e &&
      isTimedEvent(e)
    );

    durationMinus.disabled=!enabled;
    durationPlus.disabled=!enabled;
    durationValue.disabled=!enabled;

    if(!enabled){
      durationValue.textContent='—';
      durationValue.title='Select a note, chord, movement, or rest';
      return;
    }

    const units=eventDurationUnits(e);
    durationValue.textContent=durationMeta(units).symbol;
    durationValue.title=durationMeta(units).name;
  }

  function scrollScoreToEvent(eventIndex,behavior='smooth'){
    const node=scoreSvg.querySelector(`.scoreEvent[data-event-index="${eventIndex}"]`);
    if(!node) return;

    const x=Number(node.dataset.scoreX);
    if(!Number.isFinite(x)) return;

    const target=Math.max(0,x-scoreViewport.clientWidth*.45);
    try{
      scoreViewport.scrollTo({left:target,behavior});
    }catch(_){
      scoreViewport.scrollLeft=target;
    }
  }

  function clampScorePopupOffset(offset){
    if(!scorePopupCard) return 0;

    const viewportH=window.innerHeight || document.documentElement.clientHeight || 0;
    const cardH=scorePopupCard.offsetHeight || 0;
    const safeGap=10;
    const maxOffset=Math.max(0,(viewportH-cardH)/2-safeGap);

    return Math.max(-maxOffset,Math.min(maxOffset,offset));
  }

  function applyScorePopupOffset(){
    S.scorePopupOffsetY=clampScorePopupOffset(S.scorePopupOffsetY || 0);
    scorePopupCard.style.transform=`translateY(${S.scorePopupOffsetY}px)`;
  }

  const scoreDragState={
    active:false,
    pointerId:null,
    startY:0,
    startOffset:0
  };

  function scoreToolbarIsControl(target){
    return !!(
      target &&
      target.closest &&
      target.closest('button')
    );
  }

  function beginScoreDrag(e){
    if(!scoreTimingActive()) return;
    if(scoreToolbarIsControl(e.target)) return;

    scoreDragState.active=true;
    scoreDragState.pointerId=e.pointerId;
    scoreDragState.startY=e.clientY;
    scoreDragState.startOffset=S.scorePopupOffsetY || 0;

    try{scoreToolbar.setPointerCapture(e.pointerId)}catch(_){}
    e.preventDefault();
  }

  function moveScoreDrag(e){
    if(!scoreDragState.active || e.pointerId!==scoreDragState.pointerId) return;

    const next=scoreDragState.startOffset+(e.clientY-scoreDragState.startY);
    S.scorePopupOffsetY=clampScorePopupOffset(next);
    scorePopupCard.style.transform=`translateY(${S.scorePopupOffsetY}px)`;
    e.preventDefault();
  }

  function endScoreDrag(e){
    if(!scoreDragState.active) return;
    if(
      scoreDragState.pointerId!==null &&
      e.pointerId!==undefined &&
      e.pointerId!==scoreDragState.pointerId
    ) return;

    scoreDragState.active=false;
    try{
      if(scoreDragState.pointerId!==null){
        scoreToolbar.releasePointerCapture(scoreDragState.pointerId);
      }
    }catch(_){}
    scoreDragState.pointerId=null;
  }

  function scoreFretboardPositionsForEvent(e){
    if(!e || e.type===EVENT_TYPE.REST) return [];

    if(e.type===EVENT_TYPE.FINGER_ON){
      return [{s:e.s,f:e.f}];
    }

    if(e.type===EVENT_TYPE.CHORD){
      return (e.notes || []).map(clonePos).filter(Boolean);
    }

    if(isChordMoveEvent(e)){
      const result=(e.chordAfter || []).map(clonePos).filter(Boolean);

      if(e.movement===MOVEMENT_TYPE.BEND){
        const idx=result.findIndex(p=>p.s===e.to.s && p.f===e.to.f);
        const physical=e.bendHome || e.from;
        if(idx>=0 && physical) result[idx]=clonePos(physical);
      }

      return result;
    }

    if(isMoveEvent(e)){
      if(e.movement===MOVEMENT_TYPE.BEND){
        // The sounding bend target may be a phantom pitch. Show the actual
        // physical fret where the guitarist's finger is located.
        const physical=e.bendHome || (
          e.bendPhase===BEND_PHASE.PRE_RELEASE ? e.to : e.from
        );
        return physical ? [clonePos(physical)] : [];
      }

      return e.to ? [clonePos(e.to)] : [];
    }

    return [];
  }

  function renderScoreFretboardPositions(){
    if(!scoreTimingActive()) return;

    // Replace the ordinary "final state" pink markers with the full set of
    // physical positions represented by the timed sequence.
    document.querySelectorAll('.fingerMark').forEach(x=>x.remove());

    const marks=new Map();

    for(let eventIndex=0;eventIndex<S.events.length;eventIndex++){
      const e=S.events[eventIndex];
      if(!isTimedEvent(e)) continue;

      for(const p of scoreFretboardPositionsForEvent(e)){
        if(!p) continue;
        const key=posKey(p.s,p.f);

        if(!marks.has(key)){
          const mark=makeMark(
            fingerMarkClass(p,'scoreFingerPosition'),
            p.s,
            p.f,
            positionLabel(p.s,p.f,'admin')
          );
          marks.set(key,mark);
        }
      }
    }

    const active=(
      S.editSelectionKind==='timing' &&
      Number.isInteger(S.editEventIndex)
    ) ? S.events[S.editEventIndex] : null;

    if(active){
      for(const p of scoreFretboardPositionsForEvent(active)){
        if(!p) continue;
        const key=posKey(p.s,p.f);
        let mark=marks.get(key);

        if(!mark){
          mark=makeMark(
            fingerMarkClass(p,'scoreFingerPosition'),
            p.s,
            p.f,
            positionLabel(p.s,p.f,'admin')
          );
          marks.set(key,mark);
        }

        mark.classList.add('scoreFingerActive');
      }
    }
  }

  function scoreTimingActive(){
    return !!(
      S.scoreVisible &&
      !document.body.classList.contains('player') &&
      currentAuthorMode()==='played'
    );
  }

  function updateScoreUI(){
    const active=scoreTimingActive();

    scoreSection.hidden=!active;
    scoreSection.setAttribute('aria-hidden',active?'false':'true');
    scoreToggleBtn.classList.toggle('on',active);
    document.body.classList.toggle('scoreFocus',active);

    if(active){
      requestAnimationFrame(()=>{
        applyScorePopupOffset();
        renderScore({followEnd:true});
        renderScoreFretboardPositions();
      });
    }

    scheduleSequenceFrameSync();
  }

  function toggleScoreTiming(){
    if(
      document.body.classList.contains('player') ||
      currentAuthorMode()!=='played'
    ) return;

    S.scoreVisible=!S.scoreVisible;

    if(S.scoreVisible){
      // Open at the lowest safe vertical position every time.
      S.scorePopupOffsetY=Number.MAX_SAFE_INTEGER;
    }

    // Score timing is a separate phase from historical editing. Entering or
    // leaving it clears only the selection cursor, never the stored music.
    if(Number.isInteger(S.editEventIndex)){
      S.editEventIndex=null;
      S.editSelectionKind=null;
      S.previewEventIndex=null;
      renderAuthor();
      renderEventList();
    }

    updateScoreUI();

    statusEl.innerHTML=S.scoreVisible
      ? '<strong>Score timing</strong><br>Tap a note or rest in the score, then use − / + to change its duration.'
      : '<strong>Played Notes</strong><br>Score closed. Continue building or editing notes on the full fretboard.';
  }

  function closeScorePopup(){
    if(!S.scoreVisible) return;

    S.scoreVisible=false;
    S.editEventIndex=null;
    S.editSelectionKind=null;
    S.previewEventIndex=null;

    renderAuthor();
    renderEventList();
    updateScoreUI();
    document.body.classList.remove('scoreFocus');

    statusEl.innerHTML=
      '<strong>Played Notes</strong><br>Score closed. Continue building or editing notes on the full fretboard.';
  }

  function drawScoreOttavaSpan(svg,span){
    if(!span) return;
    const x1=span.x1;
    const x2=Math.max(span.x2,x1+34);
    const y=26;

    svg.appendChild(scoreEl('text',{
      x:x1,y:y+2,class:'scoreOttavaText'
    },'8va'));

    svg.appendChild(scoreEl('line',{
      x1:x1+20,y1:y-2,x2:x2,y2:y-2,class:'scoreOttavaLine'
    }));

    svg.appendChild(scoreEl('line',{
      x1:x2,y1:y-2,x2:x2,y2:y+6,stroke:'#111','stroke-width':1
    }));
  }

  function renderScore({followEnd=false}={}){
    const timed=[];
    let totalUnits=0;

    S.events.forEach((e,eventIndex)=>{
      if(!isTimedEvent(e)) return;
      const units=eventDurationUnits(e);
      timed.push({e,eventIndex,startUnit:totalUnits,units});
      totalUnits+=units;
    });

    const measures=Math.max(1,Math.ceil(Math.max(totalUnits,1)/SCORE_UNITS_PER_MEASURE));
    const width=SCORE_LEFT+measures*SCORE_MEASURE_PX+18;

    scoreSvg.setAttribute('viewBox',`0 0 ${width} ${SCORE_HEIGHT}`);
    scoreSvg.setAttribute('width',String(width));
    scoreSvg.setAttribute('height',String(SCORE_HEIGHT));
    scoreSvg.innerHTML='';

    // Staff
    for(const y of SCORE_LINE_YS){
      scoreSvg.appendChild(scoreEl('line',{
        x1:SCORE_LEFT-4,y1:y,x2:width-8,y2:y,
        stroke:'#222','stroke-width':1
      }));
    }

    // Clef + 4/4
    scoreSvg.appendChild(scoreEl('text',{
      x:12,y:85,class:'scoreClef'
    },'𝄞'));
    scoreSvg.appendChild(scoreEl('text',{
      x:31,y:101,'text-anchor':'middle',class:'scoreClefOctave'
    },'8'));
    scoreSvg.appendChild(scoreEl('text',{
      x:68,y:58,'text-anchor':'middle',class:'scoreTime'
    },'4'));
    scoreSvg.appendChild(scoreEl('text',{
      x:68,y:77,'text-anchor':'middle',class:'scoreTime'
    },'4'));

    // Automatic measures
    for(let m=0;m<=measures;m++){
      const x=SCORE_LEFT+m*SCORE_MEASURE_PX;
      scoreSvg.appendChild(scoreEl('line',{
        x1:x,y1:SCORE_LINE_YS[0],x2:x,y2:SCORE_LINE_YS[4],
        stroke:'#1b1b1b','stroke-width':m===0?1.3:1.1
      }));
      if(m<measures){
        scoreSvg.appendChild(scoreEl('text',{
          x:x+5,y:15,class:'scoreMeasureNumber'
        },String(m+1)));
      }
    }

    const tieRequests=[];
    const ottavaSpans=[];

    for(const item of timed){
      const {e,eventIndex,startUnit,units}=item;
      const fragments=splitDurationAcrossMeasures(startUnit,units);
      const use8va=scoreEventUses8va(e);

      if(use8va){
        const x1=SCORE_LEFT+startUnit*SCORE_UNIT_PX+7-12;
        const x2=SCORE_LEFT+(startUnit+units)*SCORE_UNIT_PX+7-5;
        const previous=ottavaSpans[ottavaSpans.length-1];

        if(previous && previous.endUnit===startUnit){
          previous.x2=x2;
          previous.endUnit=startUnit+units;
        }else{
          ottavaSpans.push({x1,x2,startUnit,endUnit:startUnit+units});
        }
      }

      fragments.forEach((frag,fragIndex)=>{
        const x=SCORE_LEFT+frag.startUnit*SCORE_UNIT_PX+7;
        const g=scoreEl('g',{
          class:'scoreEvent',
          'data-event-index':eventIndex,
          'data-score-x':x
        });
        g.dataset.eventIndex=String(eventIndex);
        g.dataset.scoreX=String(x);

        const selected=(
          !document.body.classList.contains('player') &&
          S.editEventIndex===eventIndex
        );
        const playing=(
          document.body.classList.contains('player') &&
          S.playbackEventIndex===eventIndex
        );
        if(selected) g.classList.add('selected');
        if(playing) g.classList.add('playing');

        // Wide transparent hit/selection area centered on rhythmic onset.
        g.appendChild(scoreEl('rect',{
          x:x-15,y:18,width:30,height:96,rx:7,
          class:'scoreSelection'
        }));
        g.appendChild(scoreEl('rect',{
          x:x-16,y:14,width:32,height:104,
          class:'scoreHit'
        }));

        drawScoreEventFragment(g,e,frag,x,selected,use8va);
        scoreSvg.appendChild(g);

        bindTap(g,()=>{
          if(document.body.classList.contains('player')) return;
          selectTimedEventForDuration(eventIndex);
        });

        if(e.type!==EVENT_TYPE.REST && fragIndex<fragments.length-1){
          const next=fragments[fragIndex+1];
          const x2=SCORE_LEFT+next.startUnit*SCORE_UNIT_PX+7;
          tieRequests.push({x1:x+6,x2:x2-6});
        }
      });
    }

    // Draw ties above the staff after note groups, so barlines remain readable.
    for(const tie of tieRequests){
      const mid=(tie.x1+tie.x2)/2;
      const d=`M ${tie.x1} 98 Q ${mid} 108 ${tie.x2} 98`;
      scoreSvg.appendChild(scoreEl('path',{
        d,fill:'none',stroke:'#222','stroke-width':1.15
      }));
    }

    for(const span of ottavaSpans){
      drawScoreOttavaSpan(scoreSvg,span);
    }

    updateDurationEditor();

    if(scoreTimingActive()){
      renderScoreFretboardPositions();
    }

    if(document.body.classList.contains('player') && Number.isInteger(S.playbackEventIndex)){
      requestAnimationFrame(()=>scrollScoreToEvent(S.playbackEventIndex,'smooth'));
    }else if(Number.isInteger(S.editEventIndex)){
      requestAnimationFrame(()=>scrollScoreToEvent(S.editEventIndex,'smooth'));
    }else if(!document.body.classList.contains('player') || followEnd){
      requestAnimationFrame(()=>{
        scoreViewport.scrollLeft=Math.max(0,scoreViewport.scrollWidth-scoreViewport.clientWidth);
      });
    }
  }

  function selectTimedEventForDuration(eventIndex){
    if(!scoreTimingActive()) return;

    const e=S.events[eventIndex];
    if(!e || !isTimedEvent(e)) return;

    if(
      !document.body.classList.contains('player') &&
      S.editEventIndex===eventIndex &&
      S.editSelectionKind==='timing'
    ){
      clearAuthorEditSelection(true);
      statusEl.innerHTML=toolHelp();
      return;
    }

    if(S.fingeringAssign.active){
      cancelFingeringAssignment(false);
    }

    if(S.tool!=='finger'){
      setTool('finger');
    }

    resetPendingAuthoringState();
    S.previewEventIndex=null;
    S.editEventIndex=eventIndex;
    S.editSelectionKind='timing';

    renderEventList();
    renderScore();
    auditionEventPitch(e);

    statusEl.innerHTML=
      `<strong>${e.type===EVENT_TYPE.REST?'Rest':'Played Note'} selected</strong><br>`+
      `${durationMeta(eventDurationUnits(e)).name}. Use − / + above the score to change duration.`+
      `${e.type===EVENT_TYPE.REST?'':' Its fretboard position is highlighted.'}`;
  }

  function changeSelectedDuration(direction){
    const e=selectedAuthorEditEvent();
    if(!e || !isTimedEvent(e)) return;

    const current=eventDurationUnits(e);
    let index=SCORE_DURATION_VALUES.indexOf(current);
    if(index<0) index=SCORE_DURATION_VALUES.indexOf(SCORE_DEFAULT_DURATION_UNITS);

    const nextIndex=Math.max(
      0,
      Math.min(SCORE_DURATION_VALUES.length-1,index+direction)
    );
    if(nextIndex===index) return;

    pushAuthorSnapshot();
    e.durationUnits=SCORE_DURATION_VALUES[nextIndex];

    rebuildAuthor();
    renderScore();
    auditionEventPitch(e);

    statusEl.innerHTML=
      `<strong>${durationMeta(e.durationUnits).name}</strong><br>`+
      'The score and all later measure positions have been reflowed.';
  }

  function clearSequenceSelection(){
    S.previewEventIndex=null;
    eventPanel.querySelectorAll('.event').forEach(el=>el.classList.remove('selected'));
  }

  function exitSequencePreview(){
    if(S.previewEventIndex===null) return;
    clearSequenceSelection();

    if(Number.isInteger(S.editEventIndex)){
      renderSelectedAuthorEvent();
    }else{
      renderAuthor();
    }
  }

  function previewSequenceState(originalEventIndex,row){
    if(S.fingeringAssign.active) return;
    const st=blankState();
    for(let i=0;i<=originalEventIndex;i++){
      applyEventInstant(st,S.events[i]);
    }
    S.previewEventIndex=originalEventIndex;
    renderState(st);
    eventPanel.querySelectorAll('.event').forEach(el=>el.classList.remove('selected'));
    if(row) row.classList.add('selected');
  }

  function renderEventList(){
    const visible=[];
    S.events.forEach((e,originalIndex)=>{
      if(e.play!==false) visible.push({e,originalIndex});
    });

    if(!visible.length){
      eventPanel.innerHTML='<div class="event noEvents"><span class="n">—</span>No playback events yet</div>';
      renderScore();
      return;
    }

    const targetEventIndexes=S.fingeringAssign.active
      ? new Set(S.fingeringAssign.targets.map(target=>target.eventIndex))
      : new Set();

    eventPanel.innerHTML=visible.map(({e,originalIndex},i)=>{
      let classes='event';

      if(targetEventIndexes.has(originalIndex)){
        classes+=' fingeringTargetRow';
      }

      if(!S.fingeringAssign.active && authorEventEditableInCurrentMode(e)){
        classes+=' authorEditableRow';
        classes+=S.tool==='framework'
          ? ' frameworkEditable'
          : ' playedEditable';
      }

      if(
        !S.fingeringAssign.active &&
        S.editEventIndex===originalIndex
      ){
        classes+=' selected';
      }

      return `<div class="${classes}" data-original-index="${originalIndex}"><span class="n">${i+1}</span>${describe(e)}</div>`;
    }).join('');

    eventPanel.querySelectorAll('.event[data-original-index]').forEach(row=>{
      bindTap(row,()=>{
        const idx=Number(row.dataset.originalIndex);

        if(S.fingeringAssign.active){
          jumpToFingeringEvent(idx);
          return;
        }

        selectAuthorEventForEditing(idx,row);
      });
    });

    if(S.fingeringAssign.active) return;

    if(Number.isInteger(S.editEventIndex)){
      const row=eventPanel.querySelector(
        `.event[data-original-index="${S.editEventIndex}"]`
      );
      if(row) row.scrollIntoView({block:'nearest'});
    }else{
      eventPanel.scrollTop=eventPanel.scrollHeight;
    }
  }

  function currentAuthorMode(){
    if(S.fingeringAssign.active) return 'fingering';
    return S.tool==='framework' ? 'framework' : 'played';
  }

  let sequenceFrameSyncRaf=0;

  function syncSequenceFrameHeight(){
    sequenceFrameSyncRaf=0;

    if(
      !sequenceWrap ||
      !fretboardWrap ||
      document.body.classList.contains('player') ||
      document.body.classList.contains('scoreFocus')
    ){
      if(sequenceWrap) sequenceWrap.style.height='';
      return;
    }

    // The sequence panel's TOP depends on the current authoring mode because
    // Played Notes has the Movement block while Framework/Fingering do not.
    // Its BOTTOM is always locked to the outer fretboard frame.
    const sequenceRect=sequenceWrap.getBoundingClientRect();
    const fretboardRect=fretboardWrap.getBoundingClientRect();

    const height=Math.max(
      72,
      Math.round(fretboardRect.bottom-sequenceRect.top)
    );

    sequenceWrap.style.height=`${height}px`;
  }

  function scheduleSequenceFrameSync(){
    if(sequenceFrameSyncRaf){
      cancelAnimationFrame(sequenceFrameSyncRaf);
    }

    sequenceFrameSyncRaf=requestAnimationFrame(()=>{
      // One additional frame allows hidden/shown mode controls to finish
      // changing the sequence panel's top position before it is measured.
      sequenceFrameSyncRaf=requestAnimationFrame(syncSequenceFrameHeight);
    });
  }

  function updateAuthorModeUI(){
    const mode=currentAuthorMode();

    authorModeBtn.classList.remove(
      'mode-framework',
      'mode-played',
      'mode-fingering'
    );

    if(mode==='framework'){
      authorModeBtn.textContent='Framework';
      authorModeBtn.classList.add('mode-framework');
    }else if(mode==='played'){
      authorModeBtn.textContent='Played Notes';
      authorModeBtn.classList.add('mode-played');
    }else{
      authorModeBtn.textContent='Fingering';
      authorModeBtn.classList.add('mode-fingering');
    }

    const showMovement=(
      mode==='played' &&
      !document.body.classList.contains('player')
    );
    movementSection.hidden=!showMovement;
    movementSeparator.hidden=!showMovement;

    updateScoreUI();
    scheduleSequenceFrameSync();
  }

  async function cycleAuthorMode(){
    const mode=currentAuthorMode();

    if(mode==='framework'){
      setTool('finger');
      return;
    }

    if(mode==='played'){
      // Always enter Fingering, even if there are currently no fretted
      // assignments. The Mode button must never get trapped on Played Notes.
      await startFingeringAssignment();
      updateAuthorModeUI();
      return;
    }

    // Fingering -> Framework.
    setTool('framework');
  }

  function toolHelp(){
    const editing=selectedAuthorEditEvent();
    if(editing && authorEventEditableInCurrentMode(editing)){
      return authorEditHelp(editing);
    }

    if(S.tool==='framework')
      return '<strong>Framework</strong><br>Tap to turn a framework note on/off, or tap a Framework row below to edit that stored event.';

    if(S.pendingMove==='bend'){
      const entry=currentFingerEntry();

      if(S.pendingPreBend && S.pendingPreBend.sounding){
        return '<strong>Bend armed</strong><br>'+
          'The sounding note is now a phantom pitch. Tap a lower fret on the same string for the physical pre-bend position, or tap a higher fret for a normal bend.';
      }

      if(entry && entry.kind==='bendRing')
        return '<strong>Bend armed</strong><br>Tap the linked original fret to release the bend.';
    }

    if(S.pendingMove){
      if(S.pendingChordMove){
        return `<strong>${prettyMove(S.pendingMove)} armed for chord</strong><br>`+
          'Tap the destination on one of the chord strings. Only that voice will move; the other chord tones stay held.';
      }
      return `<strong>${prettyMove(S.pendingMove)} armed</strong><br>Tap the destination note. The origin will be replaced by the destination.`;
    }

    const entry=currentFingerEntry();
    if(entry && entry.kind==='bendRing')
      return '<strong>Pink ring</strong><br>This is a bent pitch. Choose Bend, then tap its original fret to release it.';

    const pinkCount=currentPinkPositions().length;
    if(pinkCount>1)
      return '<strong>Pink notes</strong><br>Press Chord to group the visible pink notes into one simultaneous event, or choose another movement.';
    if(scoreTimingActive()){
      return '<strong>Score timing</strong><br>Tap a note or rest in the score, then use − / +.';
    }

    return '<strong>Played Notes</strong><br>Tap an empty position for a pluck. Tap an existing pink note to turn it off. Use Movement controls normally; turn Score on only when you are ready to edit timing.';
  }

  function announce(msg,playback){
    statusEl.innerHTML=`<strong>${msg}</strong><br>${playback?'Added as a 1-second playback event.':'Admin edit only — no playback time added.'}`;
    setTimeout(()=>{
      if(!document.body.classList.contains('player')) statusEl.innerHTML=toolHelp();
    },1200);
  }

  function setTool(tool){
    const wasAssigning=S.fingeringAssign.active;
    if(wasAssigning) cancelFingeringAssignment(false);

    exitSequencePreview();
    S.editEventIndex=null;
    S.editSelectionKind=null;
    S.tool=tool;

    if(tool!=='finger'){
      S.pendingMove=null;
      S.pendingPreBend=null;
      S.pendingChordMove=null;
      updateMoveButtons();
    }

    if(wasAssigning){
      // Restore the ordinary authored note display only after the user
      // explicitly chooses to leave Fingering.
      renderAuthor();
    }

    updateAuthorModeUI();
    updateChordButton();
    statusEl.innerHTML=toolHelp();
  }

  function armMove(kind){
    if(
      Number.isInteger(S.editEventIndex) &&
      S.tool==='finger' &&
      S.editSelectionKind==='edit'
    ){
      const selected=selectedAuthorEditEvent();

      if(selected && selected.type==='move'){
        editSelectedMovementType(kind);
        return;
      }

      if(kind==='chord' && selected && selected.type==='chord'){
        statusEl.innerHTML=authorEditHelp(selected);
        return;
      }

      statusEl.innerHTML='<strong>Historical event selected.</strong><br>To change a movement type, select a movement row. Tap the selected row again to leave editing before creating a new movement.';
      return;
    }

    if(S.editSelectionKind==='timing'){
      clearAuthorEditSelection(false);
    }

    if(kind==='chord'){
      groupCurrentPinkAsChord();
      return;
    }

    if(S.fingeringAssign.active) cancelFingeringAssignment(false);
    exitSequencePreview();
    if(S.tool!=='finger') setTool('finger');

    if(S.pendingMove===kind){
      S.pendingMove=null;
      S.pendingChordMove=null;
      clearPendingPreBend(true);
    }else{
      const chordContext=currentChordMovementContext();

      if(!S.author.currentOrigin && !chordContext){
        announce('Add a pink origin note or chord first.',false);
        return;
      }

      S.pendingMove=kind;
      S.pendingPreBend=null;
      S.pendingChordMove=chordContext;

      if(kind==='bend' && !chordContext){
        const ref=currentOriginSourceRef();
        const source=ref ? S.events[ref.eventIndex] : null;
        const entry=currentFingerEntry();

        // A just-placed ordinary pluck is eligible to become a pre-bend.
        // We do not mutate the clip yet: the phantom ring is a pending visual
        // state until the user chooses the physical lower fret.
        if(
          ref &&
          source &&
          source.type==='fingerOn' &&
          entry &&
          entry.kind!=='bendRing'
        ){
          S.pendingPreBend={
            sourceEventIndex:ref.eventIndex,
            sounding:clonePos(S.author.currentOrigin)
          };
          renderPendingPreBendChoice();
        }
      }
    }
    updateMoveButtons();
    statusEl.innerHTML=toolHelp();
  }

  function updateMoveButtons(){
    document.querySelectorAll('.moveBtn').forEach(b=>{
      if(b.dataset.move==='chord'){
        b.classList.remove('on');
      }else{
        b.classList.toggle('on',b.dataset.move===S.pendingMove);
      }
    });
    updateChordButton();
  }

  function resetPendingAuthoringState(){
    S.pendingMove=null;
    S.pendingPreBend=null;
    S.pendingChordMove=null;
    updateMoveButtons();
  }

  function isDynamicEvent(e){
    return e && !isFrameworkEvent(e);
  }

  function removeLastMatchingEvent(predicate){
    for(let i=S.events.length-1;i>=0;i--){
      if(predicate(S.events[i])){
        S.events.splice(i,1);
        return true;
      }
    }
    return false;
  }

  function clearMatchingEvents(predicate){
    const before=S.events.length;
    S.events=S.events.filter(e=>!predicate(e));
    return S.events.length!==before;
  }

  function undoFingeringAssignment(){
    if(!S.fingeringAssign.active) return false;

    const snapshot=S.fingeringAssign.assignmentHistory.pop();
    if(!snapshot) return false;

    return restoreFingeringSnapshot(snapshot);
  }

  function clearFingeringAssignmentsOnly(){
    if(!S.fingeringAssign.active) return false;

    pushFingeringSnapshot();
    hideFingeringConfirmDialog();

    clearFingerAssignmentData();
    S.fingeringAssign.targets=fingeringTargets();
    S.fingeringAssign.cursor=0;
    S.fingeringAssign.selectedChordNoteIndex=null;
    S.fingeringAssign.completedChordReviewEventIndex=null;
    S.fingeringAssign.confirmingChordEventIndex=null;

    prepareFingeringTargetPose(currentFingeringTarget());
    renderEventList();
    showFingeringTarget(false);
    return true;
  }

  function undo(){
    exitSequencePreview();

    // Fingering mode: undo only the most recent finger assignment.
    if(S.fingeringAssign.active){
      if(undoFingeringAssignment()){
        announce('Last fingering assignment undone.',false);
      }
      return;
    }

    const historyKey=authorModeHistoryKey();
    const history=S.authorEditHistory[historyKey];

    if(history && history.length){
      const snapshot=history.pop();
      restoreAuthorSnapshot(snapshot);
      statusEl.innerHTML='<strong>Authoring edit undone.</strong><br>'+toolHelp();
      return;
    }

    let changed=false;

    // Legacy fallback for a clip created before the snapshot stack existed.
    if(S.tool==='framework'){
      changed=removeLastMatchingEvent(isFrameworkEvent);
    }else if(S.tool==='finger'){
      changed=removeLastMatchingEvent(isDynamicEvent);
    }

    if(!changed) return;

    resetPendingAuthoringState();
    rebuildAuthor();
    statusEl.innerHTML=toolHelp();
  }

  function clearAll(){
    exitSequencePreview();

    // Fingering mode: Clear means clear fingering assignments only. It does
    // not remove Framework notes, Played Notes, or movement events.
    if(S.fingeringAssign.active){
      if(clearFingeringAssignmentsOnly()){
        announce('Fingering assignments cleared.',false);
      }
      return;
    }

    let changed=false;

    // Framework mode: Clear removes Framework events only.
    if(S.tool==='framework'){
      if(S.events.some(isFrameworkEvent)) pushAuthorSnapshot();
      changed=clearMatchingEvents(isFrameworkEvent);
    }
    // Played Notes mode: Clear removes played notes/movements/edit events only.
    else if(S.tool==='finger'){
      if(S.events.some(isDynamicEvent)) pushAuthorSnapshot();
      changed=clearMatchingEvents(isDynamicEvent);
      if(changed){
        S.nextBendId=1;
        S.nextChordId=1;
      }
    }

    if(changed){
      S.editEventIndex=null;
      S.editSelectionKind=null;
    }

    resetPendingAuthoringState();

    if(changed) rebuildAuthor();
    else renderAuthor();

    statusEl.innerHTML=toolHelp();
  }

  function setupSvg(){moveSvg.setAttribute('viewBox','0 0 183 642')}

  function makeAnimatedPinkLine(from,to){
    setupSvg();
    const a=shellPoint(from.s,from.f);
    const z=shellPoint(to.s,to.f);
    const ns='http://www.w3.org/2000/svg';

    const line=document.createElementNS(ns,'line');
    line.setAttribute('x1',a.x);
    line.setAttribute('y1',a.y);
    line.setAttribute('x2',z.x);
    line.setAttribute('y2',z.y);
    line.setAttribute('stroke','#ff1493');
    line.setAttribute('stroke-width','4');
    line.setAttribute('stroke-linecap','round');
    line.setAttribute('pathLength','1');
    line.setAttribute('stroke-dasharray','1');
    line.setAttribute('stroke-dashoffset','1');
    moveSvg.appendChild(line);

    return {line,a,z};
  }

  function showMoveLabel(kind,a,z){
    const lab=document.createElement('div');
    lab.className='moveLabel';
    lab.textContent=prettyMove(kind);
    lab.style.left=((a.x+z.x)/2)+'px';
    lab.style.top=((a.y+z.y)/2 - 13)+'px';
    shell.appendChild(lab);
    return lab;
  }

  const pendingSleeps=new Map();

  function sleep(ms){
    return new Promise(resolve=>{
      const id=setTimeout(()=>{
        pendingSleeps.delete(id);
        resolve();
      },Math.max(0,ms));

      pendingSleeps.set(id,resolve);
    });
  }

  function cancelPendingSleeps(){
    for(const [id,resolve] of pendingSleeps.entries()){
      clearTimeout(id);
      try{resolve()}catch(_){}
    }
    pendingSleeps.clear();
  }

  async function waitForTimedEventWindow(startedAt,e,run){
    const remaining=eventDurationMs(e)-(performance.now()-startedAt);
    if(remaining>0) await sleep(remaining);
    return run===S.runId;
  }


  async function animateMove(e,run){
    const startedAt=performance.now();

    // The unassigned path uses exactly the same articulation dispatcher;
    // only the physical finger rectangles are omitted.
    renderPlayback();

    await performMovementPlayback(
      e,
      run,
      {withHand:false,targetPose:null}
    );
    if(run!==S.runId) return;

    // Preserve the just-completed animated marker geometry.
    applyEventInstant(S.playback,e);

    await waitForTimedEventWindow(startedAt,e,run);
  }

  function renderPlaybackFrameworkOnly(){
    document.querySelectorAll('.frameworkMark').forEach(x=>x.remove());
    for(const p of S.playback.framework.values()){
      makeMark(frameworkMarkClass(p),p.s,p.f,positionLabel(p.s,p.f,'player'));
    }
  }

  async function playOne(e,run){
    if(e.type===EVENT_TYPE.REST){
      silenceActiveGuitarSources(.025);
      applyEventInstant(S.playback,e);
      renderPlayback();

      // Rest affects sound/notation state only; assigned hand remains where
      // the preceding event left it.
      if(S.useAssignedFingering){
        showPlaybackFingers();
        drawFingerPose(S.fingerPose,false);
      }

      await sleep(eventDurationMs(e));
      return;
    }

    if(e.type==='chord'){
      applyEventInstant(S.playback,e);
      renderPlayback();

      if(S.useAssignedFingering){
        showPlaybackFingers();

        // Active chord fingers use the validated chord geometry.
        // Unused fingers retract normally instead of swinging into far-right capsules.
        S.fingerPose=chordApproxFingerPose(e.notes || []);
        drawPlayerChordHand(
          e.notes || [],
          S.fingerPose,
          false
        );
      }else{
        clearChordBarres();
      }

      // All chord samples are triggered in the same JavaScript turn.
      for(const note of e.notes || []){
        playStringSample(note.s,note.f,.24,Math.max(.18,eventDurationMs(e)/1000*.92));
      }

      await sleep(eventDurationMs(e));
      return;
    }

    if(isChordMoveEvent(e)){
      let targetPose=null;

      if(S.useAssignedFingering){
        showPlaybackFingers();
        targetPose=nextFingerPoseForEvent(S.fingerPose,e);
        S.fingerPose=targetPose;
      }

      await performChordMovementPlayback(
        e,
        run,
        {withHand:S.useAssignedFingering,targetPose}
      );
      if(run!==S.runId) return;

      applyEventInstant(S.playback,e);
      renderPlayback();

      // Redraw the final hand after the state renderer replaces marker DOM.
      if(S.useAssignedFingering && targetPose){
        drawFingerPose(targetPose,false);
      }
      return;
    }

    if(S.useAssignedFingering && validFingerLetter(e.finger)){
      await playFingeredOne(e,run);
      if(run!==S.runId) return;
      applyEventInstant(S.playback,e);
      return;
    }

    if(e.type==='move'){
      await animateMove(e,run);
      return;
    }

    applyEventInstant(S.playback,e);
    renderPlayback();

    if(e.type==='fingerOn'){
      playStringSample(
        e.s,
        e.f,
        .20,
        Math.max(.18,eventDurationMs(e)/1000*.92)
      );
    }

    await sleep(eventDurationMs(e));
  }

  async function playAll(){
    stopPlayback(false);
    document.body.classList.remove('fingerDemo');
    document.body.classList.remove('fingeringPlayback');

    const run=++S.runId;
    S.playback=initialPlayerFrameworkState();
    moveSvg.innerHTML='';
    document.querySelectorAll('.moveLabel').forEach(x=>x.remove());
    propagateFingerAssignments();
    S.useAssignedFingering=fingeringReady();
    S.fingerPose=S.useAssignedFingering
      ? initialAssignedRestPoseForPlayback()
      : blankFingerPose();

    if(S.useAssignedFingering){
      showPlaybackFingers();
      drawFingerPose(S.fingerPose,true);
    }else{
      hidePlaybackFingers();
    }

    renderPlayback();
    progressFill.style.width='0%';

    // Play is a user gesture, so use it to unlock/load the sampled guitar
    // before the first dynamic note is due.
    await unlockSampleAudio();
    if(run!==S.runId) return;

    const timedEvents=S.events.filter(isTimedEvent);
    const timedTotal=timedEvents.length;
    const totalUnits=timedEvents.reduce((sum,e)=>sum+eventDurationUnits(e),0);
    let completedUnits=0;
    let timedIndex=0;

    /*
      Framework events and edit-only OFF events are zero-time state changes.
      They are applied immediately at their authored sequence position.
      Only Played Notes and Movement events consume performed event time.
    */
    for(let eventIndex=0;eventIndex<S.events.length;eventIndex++){
      const e=S.events[eventIndex];
      if(run!==S.runId) return;

      if(!isTimedEvent(e)){
        applyEventInstant(S.playback,e);

        if(
          timedIndex>0 &&
          (e.type===EVENT_TYPE.FRAMEWORK_ON || e.type===EVENT_TYPE.FRAMEWORK_OFF)
        ){
          auditionEventPitch(e,{volume:.16,duration:.45});
        }

        if(S.useAssignedFingering){
          if(e.type==='frameworkOn' || e.type==='frameworkOff'){
            renderPlaybackFrameworkOnly();
          }else if(e.type==='fingerOff'){
            const dot=currentPlaybackDot();
            const ring=currentPlaybackBendRing();
            if(dot) dot.remove();
            if(ring) ring.remove();

            // Release the note but keep the hand at its last established
            // physical position. This is especially important when the next
            // sounding event is an open string.
            {
              const previousPose=cloneFingerPose(S.fingerPose);
              S.fingerPose=nextFingerPoseForEvent(previousPose,e);
            }
            showPlaybackFingers();
            clearChordBarres();
            drawFingerPose(S.fingerPose,false);
          }
        }else{
          renderPlayback();
        }
        continue;
      }

      timedIndex++;
      S.playbackEventIndex=eventIndex;

      /*
        Begin the musical/visual event before repainting score/status UI.
        Those repaints now happen inside the event's existing time window
        instead of creating a small dead gap between events.
      */
      const eventPromise=playOne(e,run);

      renderScore();
      const playerLabel=playerEventLabel(e);
      statusEl.innerHTML=`<strong>${timedIndex}/${timedTotal}</strong>${playerLabel?`<br>${playerLabel}`:''}`;
      progressFill.style.width=`${totalUnits?(completedUnits/totalUnits)*100:0}%`;

      await eventPromise;
      completedUnits+=eventDurationUnits(e);
    }

    if(run===S.runId){
      S.playbackEventIndex=null;
      renderScore();
      progressFill.style.width='100%';
      statusEl.innerHTML='<strong>Finished</strong><br>Playback complete.';
    }
  }

  function stopPlayback(reset=true){
    S.runId++;
    S.playbackEventIndex=null;
    silenceActiveGuitarSources(.02);
    cancelPendingSleeps();
    moveSvg.innerHTML='';
    document.querySelectorAll('.moveLabel').forEach(x=>x.remove());
    document.body.classList.remove('fingerDemo');
    hidePlaybackFingers();
    clearChordBarres();
    S.useAssignedFingering=false;
    S.fingerPose=blankFingerPose();
    drawFingerPose(S.fingerPose,true);
    if(reset) progressFill.style.width='0%';

    if(document.body.classList.contains('player')){
      S.playback=initialPlayerFrameworkState();
      renderPlayback();
      statusEl.innerHTML='<strong>Player</strong><br>Framework ready. Press Play to begin.';
    }else{
      renderAuthor();
    }
    renderScore();
  }

  function closePlayerKeyMenu(){
    playerKeyMenu.classList.remove('on');
  }

  function buildPlayerKeyMenu(){
    playerKeyMenu.innerHTML='';
    for(const [name,pc] of KEYS){
      const b=document.createElement('button');
      b.type='button';
      b.className='clipKeyChoice';
      b.dataset.pc=pc;
      b.textContent=name;
      bindTap(b,()=>{
        closePlayerKeyMenu();
        loadPlayerKey(Number(pc));
      });
      playerKeyMenu.appendChild(b);
    }
  }

  function showClipDialog({
    title='Open-string version required',
    text='You must include an open-string version before this clip can be approved.',
    primary='Create Open String Version',
    onPrimary=createOpenStringVersion
  }={}){
    clipDialogTitle.textContent=title;
    clipDialogText.textContent=text;
    clipDialogPrimary.textContent=primary;
    clipDialogPrimary._clipAction=onPrimary;
    clipDialog.classList.add('on');
    clipDialog.setAttribute('aria-hidden','false');
  }

  function hideClipDialog(){
    clipDialog.classList.remove('on');
    clipDialog.setAttribute('aria-hidden','true');
    clipDialogPrimary._clipAction=null;
  }

  function createOpenStringVersion(){
    hideClipDialog();
    closePlayerKeyMenu();

    if(!S.clipDraft.original){
      // If Create Open is pressed during the first Player visit, the original
      // has already been snapshotted by enterPlayer(). This is just defensive.
      S.clipDraft.original={
        keyPc:mod12(S.keyPc),
        events:cloneEvents(S.events)
      };
    }

    const original=S.clipDraft.original;
    if(!original.events.length){
      statusEl.innerHTML='<strong>No clip events to convert.</strong>';
      return;
    }

    const shift=lowestPerformedFretInEvents(original.events);
    S.clipDraft.openShift=shift;

    const openEvents=shiftEventsByFrets(original.events,-shift);
    clearFingerAssignmentsInEvents(openEvents);

    const openCount=performedOpenPositionCount(openEvents);
    if(shift>0 && openCount===0){
      statusEl.innerHTML=
        '<strong>Open-position conversion failed.</strong><br>'+
        'No performed note reached fret 0. The original lesson was left unchanged.';
      return;
    }

    const openKey=mod12(original.keyPc-shift);
    S.clipDraft.open={
      keyPc:openKey,
      events:cloneEvents(openEvents)
    };
    S.clipDraft.editingVariant='open';

    stopPlayback(false);
    document.body.classList.remove('player');
    document.getElementById('adminTab').classList.add('on');
    document.getElementById('playerTab').classList.remove('on');

    S.events=cloneEvents(openEvents);
    S.keyPc=openKey;
    keySel.value=String(openKey);
    S.author=blankState();
    rebuildAuthor();

    statusEl.innerHTML=
      `<strong>Open-string version</strong><br>`+
      `Shifted ${shift} fret${shift===1?'':'s'} toward the nut. `+
      `${openCount} performed open-string position${openCount===1?'':'s'} created. `+
      `Assign fingering to the remaining fretted notes. Open strings are phantom rings and require no finger.`;

    // Immediately open fingering assignment as requested.
    startFingeringAssignment();
  }

  function approveClip(){
    closePlayerKeyMenu();

    // Player may currently be displaying a transposition; the authoritative
    // authored variants are stored in clipDraft.
    if(!S.clipDraft.original){
      showClipDialog({
        title:'Nothing to approve',
        text:'Create and preview an animation first.',
        primary:'OK',
        onPrimary:hideClipDialog
      });
      return;
    }

    if(!S.clipDraft.open){
      showClipDialog({
        title:'Open-string version required',
        text:'You must include an open-string version before this clip can be approved.',
        primary:'Create Open String Version',
        onPrimary:createOpenStringVersion
      });
      return;
    }

    if(!variantFingeringComplete(S.clipDraft.original.events)){
      showClipDialog({
        title:'Original fingering incomplete',
        text:'Assign fingering to the fretted notes in the original version before approving this clip.',
        primary:'Return to Admin',
        onPrimary:()=>{
          hideClipDialog();
          S.clipDraft.editingVariant='original';
          enterAdmin();
          startFingeringAssignment();
        }
      });
      return;
    }

    if(!variantFingeringComplete(S.clipDraft.open.events)){
      showClipDialog({
        title:'Open-string fingering incomplete',
        text:'Complete the fingering for the open-string version before approving this clip. Open strings themselves do not require a finger.',
        primary:'Return to Open Admin',
        onPrimary:()=>{
          hideClipDialog();
          S.clipDraft.editingVariant='open';
          enterAdmin();
          startFingeringAssignment();
        }
      });
      return;
    }

    const packet=buildApprovedClipPacket();
    S.approvedClip=packet;

    try{
      sessionStorage.setItem('lessonBuilderApprovedClip',JSON.stringify(packet));
    }catch(_){}

    statusEl.innerHTML='<strong>Clip approved</strong><br>Original and open-string variants are saved for this session. Use Recall to verify the packet.';
  }

  function recallApprovedClip(){
    closePlayerKeyMenu();

    let packet=S.approvedClip;
    if(!packet){
      try{
        const raw=sessionStorage.getItem('lessonBuilderApprovedClip');
        if(raw) packet=JSON.parse(raw);
      }catch(_){}
    }

    if(!packet || !packet.original || !packet.open){
      statusEl.innerHTML='<strong>No approved clip in this session.</strong>';
      return;
    }

    S.approvedClip=packet;
    S.clipDraft.original={
      keyPc:mod12(packet.original.keyPc),
      events:cloneEvents(packet.original.events)
    };
    S.clipDraft.open={
      keyPc:mod12(packet.open.keyPc),
      events:cloneEvents(packet.open.events)
    };
    S.clipDraft.openShift=packet.openShift;
    S.clipDraft.editingVariant='original';

    // Recall deliberately opens in the original authored position.
    loadPlayerKey(packet.original.keyPc,{quiet:true});
    statusEl.innerHTML='<strong>Approved clip recalled</strong><br>Loaded in its original position. Change Key to test transposition and the authored open-string version.';
  }

  function enterAdmin(){
    if(S.fingeringAssign.active) cancelFingeringAssignment(false);
    S.editEventIndex=null;
    S.editSelectionKind=null;
    clearSequenceSelection();
    closePlayerKeyMenu();
    stopPlayback();

    document.body.classList.remove('player');
    document.getElementById('adminTab').classList.add('on');
    document.getElementById('playerTab').classList.remove('on');

    // Player may have been showing a transposed view. Restore the authored
    // variant rather than editing that temporary transposition.
    if(!restoreEditingVariantToAdmin()){
      renderAuthor();
    }

    updateAuthorModeUI();
    updateScoreUI();

    statusEl.innerHTML=S.clipDraft.editingVariant==='open'
      ? '<strong>Open-string version</strong><br>Edit the authored open-position variant.'
      : toolHelp();

    scheduleSequenceFrameSync();
  }

  function enterPlayer(){
    if(S.fingeringAssign.active) cancelFingeringAssignment(false);

    document.body.classList.remove('scoreFocus');
    scoreSection.hidden=true;
    scoreSection.setAttribute('aria-hidden','true');

    S.editEventIndex=null;
    S.editSelectionKind=null;
    S.previewEventIndex=null;
    renderAuthor();

    propagateFingerAssignments();
    snapshotVariantFromAdmin();

    stopPlayback();
    document.body.classList.add('player');
    if(sequenceWrap) sequenceWrap.style.height='';
    document.getElementById('playerTab').classList.add('on');
    document.getElementById('adminTab').classList.remove('on');

    // When reviewing the newly authored open version, show that version.
    // Otherwise Player always opens at the original authored position.
    const preferred=S.clipDraft.editingVariant==='open' && S.clipDraft.open
      ? S.clipDraft.open.keyPc
      : S.clipDraft.original.keyPc;

    loadPlayerKey(preferred,{quiet:true});
    statusEl.innerHTML=S.clipDraft.editingVariant==='open'
      ? '<strong>Player — open-string version</strong><br>Press Play to verify it, then Approve Clip.'
      : '<strong>Player</strong><br>Original position. Press Play to begin.';
  }

  KEYS.forEach(([name,pc])=>keySel.add(new Option(name,pc)));
  keySel.value='0';
  S.playerKeyPc=0;
  playerKeyBtn.textContent='Key: '+keyLabelForPc(0);
  keySel.addEventListener('change',()=>{
    exitSequencePreview();
    S.keyPc=Number(keySel.value);
    if(document.body.classList.contains('player')) renderPlayback();
    else renderAuthor();
    renderScore();
  });

  bindTap(authorModeBtn,()=>{
    cycleAuthorMode();
  });

  bindTap(scoreToggleBtn,toggleScoreTiming);
  bindTap(scoreCloseBtn,closeScorePopup);
  bindTap(restBtn,insertRest);

  scoreToolbar.addEventListener('pointerdown',beginScoreDrag,{passive:false});
  scoreToolbar.addEventListener('pointermove',moveScoreDrag,{passive:false});
  scoreToolbar.addEventListener('pointerup',endScoreDrag);
  scoreToolbar.addEventListener('pointercancel',endScoreDrag);

  window.addEventListener('resize',()=>{
    if(S.scoreVisible) requestAnimationFrame(applyScorePopupOffset);
    scheduleSequenceFrameSync();
  });

  if(typeof ResizeObserver!=='undefined' && fretboardWrap){
    const sequenceFrameObserver=new ResizeObserver(()=>{
      scheduleSequenceFrameSync();
    });
    sequenceFrameObserver.observe(fretboardWrap);
  }

  scoreSection.addEventListener('pointerup',e=>{
    if(e.target===scoreSection) closeScorePopup();
  });
  bindTap(durationMinus,()=>changeSelectedDuration(-1));
  bindTap(durationPlus,()=>changeSelectedDuration(1));

  bindTap(adminLabelBtn,()=>{
    cycleLabelMode('admin');
  });

  bindTap(playerLabelBtn,()=>{
    cycleLabelMode('player');
  });
  document.querySelectorAll('.moveBtn').forEach(b=>bindTap(b,()=>armMove(b.dataset.move)));
  let chordPointerHandled=false;

  /*
    iOS/Safari can fail to deliver a tap to fingerLayer when the transformed
    visual finger extends outside the layer's practical hit region. Resolve
    chord-finger taps at the document level in capture phase instead.
  */
  document.addEventListener('pointerup',e=>{
    if(!document.body.classList.contains('chordChoosingFinger')) return;

    const finger=chordFingerFromTap(e.clientX,e.clientY);
    if(finger<0) return;

    // This is a NEW physical tap: the explicit finger-selection step.
    suppressChordFingerSyntheticClick=false;
    if(suppressChordFingerSyntheticClickTimer){
      clearTimeout(suppressChordFingerSyntheticClickTimer);
      suppressChordFingerSyntheticClickTimer=null;
    }

    e.preventDefault();
    e.stopPropagation();
    if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation();

    unlockAudioFromGesture();
    chordPointerHandled=true;

    // Immediate visual feedback that the visible finger was actually hit.
    fingerRects.forEach((el,i)=>
      el.classList.toggle('assignmentChosen',i===finger)
    );

    chooseAssignedFinger(FINGER_LETTERS[finger]);

    setTimeout(()=>chordPointerHandled=false,250);
  },{capture:true,passive:false});

  /*
    Fallback for browsers/environments that synthesize click without a usable
    pointerup. Only consume the click when it actually lands near a finger.
  */
  document.addEventListener('click',e=>{
    if(!document.body.classList.contains('chordChoosingFinger')) return;

    // A chord-note pointerup may have switched us into this mode just before
    // Safari emits its synthetic click. That click belongs to STEP 1 and may
    // not also perform STEP 2.
    if(suppressChordFingerSyntheticClick){
      suppressChordFingerSyntheticClick=false;
      if(suppressChordFingerSyntheticClickTimer){
        clearTimeout(suppressChordFingerSyntheticClickTimer);
        suppressChordFingerSyntheticClickTimer=null;
      }

      e.preventDefault();
      e.stopPropagation();
      if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation();
      return;
    }

    if(chordPointerHandled) return;

    const finger=chordFingerFromTap(e.clientX,e.clientY);
    if(finger<0) return;

    e.preventDefault();
    e.stopPropagation();
    if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation();

    unlockAudioFromGesture();
    fingerRects.forEach((el,i)=>
      el.classList.toggle('assignmentChosen',i===finger)
    );
    chooseAssignedFinger(FINGER_LETTERS[finger]);
  },true);

  fingerRects.forEach(el=>{
    bindTap(el,()=>{
      if(!S.fingeringAssign.active) return;

      // Chord assignment is handled by the document-level geometric capture
      // listener. Ordinary single-note fingering keeps its existing buttons.
      if(document.body.classList.contains('chordChoosingFinger')) return;

      chooseAssignedFinger(el.dataset.fingerChoice);
    });
  });

  bindTap(document.getElementById('undoBtn'),undo);
  bindTap(document.getElementById('clearBtn'),clearAll);
  bindTap(document.getElementById('adminTab'),enterAdmin);
  bindTap(document.getElementById('playerTab'),enterPlayer);
  bindTap(document.getElementById('playBtn'),playAll);
  bindTap(document.getElementById('stopBtn'),()=>stopPlayback());

  bindTap(playerKeyBtn,()=>{
    playerKeyMenu.classList.toggle('on');
  });
  bindTap(createOpenBtn,createOpenStringVersion);
  bindTap(approveClipBtn,approveClip);
  bindTap(recallClipBtn,recallApprovedClip);

  bindTap(clipDialogCancel,hideClipDialog);
  bindTap(clipDialogPrimary,()=>{
    const action=clipDialogPrimary._clipAction;
    if(typeof action==='function') action();
  });

  bindTap(fingeringConfirmEdit,keepEditingConfirmedChord);
  bindTap(fingeringConfirmContinue,()=>{
    continueAfterConfirmedChord();
  });

  buildPlayerKeyMenu();

  drawBoard();
  updateAuthorModeUI();
  updateScoreUI();
  updateLabelButtons();
  scheduleSequenceFrameSync();
  updateChordButton();
  drawFingerPose(S.fingerPose,true);
  renderEventList();
  statusEl.innerHTML=toolHelp();

  function normalizeSnippetPacket(packet){
    if(!packet || typeof packet!=='object') return null;

    if(packet.format==='guitar-animation-snippet'){
      const variants=packet.variants || {};
      const original=variants.original || packet.original;
      const open=variants.open || packet.open || null;
      if(!original || !Array.isArray(original.events)) return null;

      return {
        format:'guitar-animation-snippet',
        version:Number(packet.version || 1),
        id:packet.id || '',
        title:packet.title || '',
        sourceKeyPc:mod12(
          Number.isFinite(packet.sourceKeyPc)
            ? packet.sourceKeyPc
            : original.keyPc
        ),
        openKeyPc:open ? mod12(open.keyPc) : null,
        openShift:Number.isFinite(packet.openShift) ? packet.openShift : null,
        original:{
          keyPc:mod12(original.keyPc),
          events:cloneEvents(original.events)
        },
        open:open && Array.isArray(open.events) ? {
          keyPc:mod12(open.keyPc),
          events:cloneEvents(open.events)
        } : null
      };
    }

    if(packet.format==='guitar-animation-clip' || packet.original){
      if(!packet.original || !Array.isArray(packet.original.events)) return null;
      return {
        format:packet.format || 'guitar-animation-clip',
        version:Number(packet.version || 1),
        id:packet.id || '',
        title:packet.title || '',
        sourceKeyPc:mod12(
          Number.isFinite(packet.sourceKeyPc)
            ? packet.sourceKeyPc
            : packet.original.keyPc
        ),
        openKeyPc:packet.open ? mod12(packet.open.keyPc) : null,
        openShift:Number.isFinite(packet.openShift) ? packet.openShift : null,
        original:{
          keyPc:mod12(packet.original.keyPc),
          events:cloneEvents(packet.original.events)
        },
        open:packet.open && Array.isArray(packet.open.events) ? {
          keyPc:mod12(packet.open.keyPc),
          events:cloneEvents(packet.open.events)
        } : null
      };
    }

    return null;
  }

  function loadSnippetPacket(packet,{quiet=false}={}){
    const normalized=normalizeSnippetPacket(packet);
    if(!normalized){
      if(!quiet) announce('That snippet file could not be read.',false);
      return false;
    }

    if(S.fingeringAssign.active) cancelFingeringAssignment(false);
    closePlayerKeyMenu();
    stopPlayback(false);

    S.clipDraft.original={
      keyPc:normalized.original.keyPc,
      events:cloneEvents(normalized.original.events)
    };
    S.clipDraft.open=normalized.open ? {
      keyPc:normalized.open.keyPc,
      events:cloneEvents(normalized.open.events)
    } : null;
    S.clipDraft.openShift=normalized.openShift;
    S.clipDraft.editingVariant='original';

    S.events=cloneEvents(normalized.original.events);
    S.keyPc=normalized.original.keyPc;
    S.playerKeyPc=normalized.original.keyPc;
    keySel.value=String(S.keyPc);
    S.author=blankState();
    rebuildAuthor();

    enterPlayer();

    if(normalized.title){
      document.body.dataset.snippetTitle=normalized.title;
    }else{
      delete document.body.dataset.snippetTitle;
    }

    return true;
  }

  window.GuitarSnippetRuntime=Object.freeze({
    loadSnippet:loadSnippetPacket,
    normalizeSnippet:normalizeSnippetPacket,
    enterPlayer,
    enterAdmin,
    play:playAll,
    stop:()=>stopPlayback(),
    version:'0.89-open-shift-smooth-playback'
  });

})();
