import React from 'react';
import { getAllCattle } from '../db';

export default function CattleList() {
  const [list, setList] = React.useState<any[]>([]);
  React.useEffect(() => { (async () => setList(await getAllCattle()))(); }, []);
  return (
    <div className="p-6">
      <h2 className="text-xl font-bold">Cattle</h2>
      <div className="mt-4 grid grid-cols-1 gap-3">
        {list.map(c => (
          <div key={c.id} className="p-3 rounded bg-slate-800/60">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold">{c.name} · {c.breed}</div>
                <div className="text-xs text-slate-400">Farmer: {c.farmerName} · Tag: {c.tagNumber}</div>
              </div>
              <div className="text-sm text-slate-300">{c.status}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
