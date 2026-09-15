import { useLayoutEffect, useRef } from 'react';
type Panel = 'browser' | 'terminal' | 'canvas';
/** Enforce before paint so a third panel never covers the current workspace. */
export function useWorkPanels(browser:boolean,terminal:boolean,canvas:boolean,hide:(panel:Panel)=>void) {
  const order=useRef<Panel[]>([]),callback=useRef(hide);callback.current=hide;
  useLayoutEffect(()=>{
    const visible:Panel[]=[];if(browser)visible.push('browser');if(terminal)visible.push('terminal');if(canvas)visible.push('canvas');
    order.current=order.current.filter(p=>visible.includes(p));
    for(const panel of visible)if(!order.current.includes(panel))order.current.push(panel);
    while(order.current.length>2)callback.current(order.current.shift()!);
  },[browser,terminal,canvas]);
}
