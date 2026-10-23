(() => {
  'use strict';
  const button = document.getElementById('publishSnippetBtn');
  const status = document.getElementById('publishStatus');
  if (!button) return; // Reader stays entirely player-only.
  const api = String(window.LESSON_PUBLISH_API || '').trim().replace(/\/$/, '');
  let busy = false;
  let session = null; // intentionally memory-only; never store a GitHub token.
  const pendingKey = 'guitarLessonPendingPublish';
  function say(message, error=false){ status.textContent=message;status.classList.toggle('error',error); }
  function approved(){
    try { return JSON.parse(sessionStorage.getItem('lessonBuilderApprovedClip') || 'null'); }
    catch(_){return null;}
  }
  function valid(clip){
    return clip && clip.original && Array.isArray(clip.original.events)
      && clip.open && Array.isArray(clip.open.events);
  }
  function slug(title){return String(title).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'lesson';}
  function newId(title){
    const suffix=crypto.randomUUID ? crypto.randomUUID().slice(0,8):Math.random().toString(36).slice(2,10);
    return `${slug(title)}-${suffix}`;
  }
  function pending(){
    try { return JSON.parse(sessionStorage.getItem(pendingKey)||'null'); }catch(_){return null;}
  }
  function cleanPending(){try{sessionStorage.removeItem(pendingKey)}catch(_){}}
  function savePending(task){sessionStorage.setItem(pendingKey,JSON.stringify(task));}
  async function send(task){
    if(!api){ say('Publishing is not connected yet. Complete the one-time Worker setup.',true); return; }
    if(!session){
      savePending(task);
      // OAuth state is validated at the Worker; this is not a GitHub token.
      window.location.assign(api+'/auth/start');
      return;
    }
    busy=true;button.disabled=true;say('Publishing to GitHub…');
    try {
      const response=await fetch(api+'/publish',{
        method:'POST',mode:'cors',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session},
        body:JSON.stringify(task)
      });
      let data={};try{data=await response.json()}catch(_){}
      if(response.status===401){ session=null;savePending(task);say('Authorization expired. Please sign in again.');window.location.assign(api+'/auth/start');return; }
      if(!response.ok)throw new Error(data.error || `Publishing failed (${response.status})`);
      cleanPending();
      say('Published: '+task.title+'. It should appear in the Reader after GitHub Pages updates.');
    } catch(error){say(error.message||'Could not publish. Try again.',true);console.error('Snippet publish:',error)}
    finally{busy=false;button.disabled=false}
  }
  button.addEventListener('click',async()=>{
    if(busy)return;
    if(!api){say('Publishing is not configured. See SETUP-DIRECT-SAVE.md.',true);return;}
    const clip=approved();
    if(!valid(clip)){say('First approve a clip with both original and open-string versions.',true);return;}
    const title=window.prompt('Snippet title:', 'My guitar lesson');
    if(title===null)return;
    const trimmed=title.trim();
    if(!trimmed || trimmed.length>100){say('Enter a title of 1–100 characters.',true);return;}
    const task={id:newId(trimmed),title:trimmed,snippet:{
      format:'guitar-animation-snippet',version:1,sourceKeyPc:clip.sourceKeyPc,
      openKeyPc:clip.openKeyPc,openShift:clip.openShift,
      variants:{original:clip.original,open:clip.open}
    }};
    await send(task);
  });
  // Returned via fragment so the session isn't sent to GitHub Pages in HTTP requests.
  const hash=new URLSearchParams(location.hash.slice(1));
  if(hash.has('publish_session')){
    session=hash.get('publish_session');
    history.replaceState(null,'',location.pathname+location.search);
    const task=pending(); if(task) send(task); else say('GitHub connected. Approve a clip and click Publish Snippet.');
  } else if(api){say('Approve a clip, then Publish Snippet to save directly to the Reader catalog.');}
})();
