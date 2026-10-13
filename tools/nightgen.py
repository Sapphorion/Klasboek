# Generates Night-mode overrides for every hard-coded light colour in styles.css.
import re, colorsys, sys
import os
P=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'styles.css')
s=open(P).read()
START='/* night:auto start */'; END='/* night:auto end */'
if START in s: s=s[:s.index(START)].rstrip()+'\n'
base=s[:s.index('LOOKS: colours')]
SKIP=re.compile(r'doc-preview|slide-preview|preview-paper|cover-|\.a4|print|pv-tools|toast-act|::backdrop|\.skip')
PROPS=('background','background-color','border','border-top','border-bottom','border-left','border-right','border-color','color','box-shadow','outline')
def hx(h):
    h=h.lstrip('#'); 
    if len(h)==3: h=''.join(c*2 for c in h)
    return tuple(int(h[i:i+2],16)/255 for i in (0,2,4))
def tohex(rgb): return '#'+''.join(f'{max(0,min(255,round(c*255))):02X}' for c in rgb)
def mapc(h, prop):
    r,g,b=hx(h); H,L,S=colorsys.rgb_to_hls(r,g,b)
    if prop=='color':
        if L>0.9: return '#111716'           # white text on dark fills -> dark text on light fills
        if L<0.45: return tohex(colorsys.hls_to_rgb(H, 1-L*0.55, min(S,0.6)))
        return None
    if L>0.78:   # light tints -> dark tints of the same hue
        return tohex(colorsys.hls_to_rgb(H, 0.11+(1-L)*0.55, S*0.45))
    if prop.startswith('border') and L>0.6:
        return tohex(colorsys.hls_to_rgb(H, 0.3, S*0.4))
    return None
out=[]
def walk(css, wrap=None):
    i=0
    while i<len(css):
        j=css.find('{',i)
        if j<0: break
        sel=css[i:j].strip()
        # find matching brace
        d=0;k=j
        while k<len(css):
            if css[k]=='{': d+=1
            elif css[k]=='}':
                d-=1
                if d==0: break
            k+=1
        body=css[j+1:k]
        sel=re.sub(r'/\*.*?\*/','',sel,flags=re.S).strip()
        if sel.startswith('@media'): walk(body, sel)
        elif sel.startswith('@'): pass
        elif sel and not sel.startswith(':root') and not SKIP.search(sel):
            decls=[]
            for d_ in re.sub(r'/\*.*?\*/','',body,flags=re.S).split(';'):
                if ':' not in d_: continue
                p,v=d_.split(':',1); p=p.strip(); v=v.strip()
                if p not in PROPS or '#' not in v: continue
                changed=[False]
                def rp(m):
                    n=mapc(m.group(0),p)
                    if n: changed[0]=True; return n
                    return m.group(0)
                nv=re.sub(r'#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b',rp,v)
                if changed[0]: decls.append(f'{p}: {nv}')
            if decls:
                sels=', '.join(':root[data-theme="night"] '+x.strip() for x in sel.split(','))
                rule=f'{sels} {{ {"; ".join(decls)}; }}'
                out.append(f'{wrap} {{ {rule} }}' if wrap else rule)
        i=k+1
walk(base)
s=s.rstrip()+'\n\n'+START+'\n'+'\n'.join(out)+'\n'+END+'\n'
open(P,'w').write(s); print(len(out),'rules')
