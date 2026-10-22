import { Badge, Card, ProgressBar } from '@/components/ui/Card';

export function LiveProductionTab({ workOrders }: { workOrders: any[] }) {
  const activeOrders = workOrders.filter(w => w.status === 'In Progress');

  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {activeOrders.length === 0 ? (
        <div className="col-span-full py-12 text-center text-slate-500">
          No live production orders at the moment.
        </div>
      ) : (
        activeOrders.map(order => {
          const qty = Number(order.quantity) || 0;
          const comp = Number(order.completed) || 0;
          const pct = qty > 0 ? Math.round((comp / qty) * 100) : 0;
          
          return (
            <Card key={order.id} className="p-4 flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="text-sm text-slate-800 font-bold">{order.part_name}</h4>
                  <p className="text-xs text-slate-500">{order.customer}</p>
                </div>
                <Badge variant="brand" dot>Live</Badge>
              </div>
              
              <div className="text-sm grid grid-cols-2 gap-2 mt-2">
                <div className="text-slate-500">Machine</div><div className="text-right font-medium">Auto Assigned</div>
                <div className="text-slate-500">Produced</div><div className="text-right font-bold text-green-600">{comp} / {qty}</div>
              </div>
              
              <div className="mt-2">
                <ProgressBar value={pct} color="brand" height="h-2" />
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
