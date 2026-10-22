import { useMemo, useState } from 'react';
import { FormField, inputClass } from '@/components/ui/Modal';
import { buildPartChoices, buildProductChoices, workOrdersForPart, type PartChoice } from '@/lib/partOrders';

// Product, then Part. Parts are the part lines received on the product's CUSTOMER DC / NEW PART / NO DC inwards;
// each shows how many were ordered and how many are still remaining (ordered less what has been finished).
export function ProductPartSelect({ salesOrders, inwards, workOrders, value, onChange }: {
  salesOrders: any[]; inwards: any[]; workOrders: any[];
  /** key of the chosen part ('' = none) */
  value: string;
  onChange: (choice: PartChoice | null) => void;
}) {
  const [productKey, setProductKey] = useState('');
  const products = useMemo(() => buildProductChoices(salesOrders, inwards), [salesOrders, inwards]);
  const parts = useMemo(() => {
    const label = new Map(products.map((p) => [p.key, p.label]));
    return buildPartChoices(products, inwards, workOrders).map((p) => {
      const done = workOrdersForPart(p, workOrders).reduce((s, w) => s + (Number(w.completed) || 0), 0);
      const remaining = Math.max(0, p.ordered - done);
      return { ...p, remaining, label: `${p.whole ? 'Whole product' : p.part} – ${label.get(p.productKey) ?? p.productName}  ·  Ordered ${p.ordered} · Remaining ${remaining}` };
    });
  }, [products, inwards, workOrders]);
  const options = productKey ? parts.filter((p) => p.productKey === productKey) : parts;

  const pickPart = (key: string) => {
    const part = parts.find((p) => p.key === key) ?? null;
    if (part) setProductKey(part.productKey);
    onChange(part);
  };
  const pickProduct = (key: string) => {
    setProductKey(key);
    const list = key ? parts.filter((p) => p.productKey === key) : [];
    onChange(list.length === 1 ? list[0] : null);
  };

  return (
    <div className="grid grid-cols-1 gap-3">
      <FormField label="Product">
        <select className={inputClass} value={productKey} onChange={(e) => pickProduct(e.target.value)}>
          <option value="">Select product…</option>
          {products.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </FormField>
      <FormField label="Part" required>
        <select className={inputClass} value={value} onChange={(e) => pickPart(e.target.value)}>
          <option value="">Select part…</option>
          {options.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </FormField>
    </div>
  );
}
