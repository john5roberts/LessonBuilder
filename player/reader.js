(() => {
  const select=document.getElementById('readerSnippetSelect');
  const status=document.getElementById('readerStatus');
  if(!select || !window.GuitarSnippetRuntime) return;

  let catalog=[];

  function setStatus(text){
    if(status) status.textContent=text || '';
  }

  async function readJson(url){
    const res=await fetch(url,{cache:'no-store'});
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  }

  async function loadEntry(entry){
    if(!entry) return;
    setStatus('Loading…');
    try{
      const packet=await readJson(`snippets/${entry.file}`);
      const ok=window.GuitarSnippetRuntime.loadSnippet(packet,{quiet:true});
      if(!ok) throw new Error('Unsupported snippet format');
      setStatus(entry.title || packet.title || 'Loaded');
    }catch(err){
      setStatus('Could not load snippet');
      console.error(err);
    }
  }

  async function loadCatalog(){
    try{
      const data=await readJson('snippets/index.json');
      catalog=Array.isArray(data.snippets) ? data.snippets : [];
      select.innerHTML='';

      for(const entry of catalog){
        const option=document.createElement('option');
        option.value=entry.id || entry.file;
        option.textContent=entry.title || entry.id || entry.file;
        select.appendChild(option);
      }

      if(!catalog.length){
        setStatus('No snippets');
        return;
      }

      await loadEntry(catalog[0]);
    }catch(err){
      setStatus('Could not load snippet list');
      console.error(err);
    }
  }

  select.addEventListener('change',()=>{
    const entry=catalog.find(x=>(x.id || x.file)===select.value);
    loadEntry(entry);
  });

  loadCatalog();
})();
