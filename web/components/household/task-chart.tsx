"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export type TaskChartDatum = {
  assignee: string;
  open: number;
  done: number;
};

const config = {
  open: { label: "Open", color: "var(--chart-2)" },
  done: { label: "Done", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Stacked horizontal bars of open vs done tasks per assignee. */
export function TaskChart({ data }: { data: TaskChartDatum[] }) {
  return (
    <ChartContainer config={config} className="h-[180px] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12 }}>
        <CartesianGrid horizontal={false} />
        <YAxis
          dataKey="assignee"
          type="category"
          tickLine={false}
          axisLine={false}
          width={90}
          tick={{ fontSize: 12 }}
        />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {/* Animation disabled: rAF-driven draw stalls in throttled/background tabs. */}
        <Bar dataKey="open" stackId="a" fill="var(--color-open)" radius={[4, 0, 0, 4]} isAnimationActive={false} />
        <Bar dataKey="done" stackId="a" fill="var(--color-done)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
