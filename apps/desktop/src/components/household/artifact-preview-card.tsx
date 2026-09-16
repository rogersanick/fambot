import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ArtifactPreview } from "@/lib/api";

export function ArtifactPreviewCard({
  preview,
  caption,
}: {
  preview: ArtifactPreview;
  caption?: string;
}) {
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{preview.label}</Badge>
          {preview.status && <Badge variant="secondary">{preview.status}</Badge>}
        </div>
        <CardTitle className="font-serif text-xl">{preview.title}</CardTitle>
        <CardDescription>{preview.description}</CardDescription>
      </CardHeader>
      {caption && (
        <CardContent>
          <p className="text-muted-foreground text-sm">{caption}</p>
        </CardContent>
      )}
    </Card>
  );
}
