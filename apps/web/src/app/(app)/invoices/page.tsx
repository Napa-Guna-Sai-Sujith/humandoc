"use client";

import React from "react";
import { ExternalLink, FileText } from "lucide-react";

import { EmptyState } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";

type Invoice = {
  id: string;
  number: string;
  amount: number;
  currency: string;
  status: string;
  url: string | null;
  createdAt: string;
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = React.useState<Invoice[] | null>(null);

  React.useEffect(() => {
    api
      .get<{ invoices: Invoice[] }>("/api/billing/invoices")
      .then((result) => setInvoices(result.invoices))
      .catch(() => setInvoices([]));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">Download receipts for every payment.</p>
      </div>

      {!invoices ? (
        <Skeleton className="h-40 w-full" />
      ) : invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="When you upgrade, receipts will appear here."
          action={
            <Button variant="outline" asChild>
              <a href="/pricing">See plans</a>
            </Button>
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono text-xs">{invoice.number}</TableCell>
                  <TableCell>{formatDate(invoice.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={invoice.status === "paid" ? "success" : "warning"} className="capitalize">
                      {invoice.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {new Intl.NumberFormat("en-IN", {
                      style: "currency",
                      currency: invoice.currency.toUpperCase(),
                    }).format(invoice.amount / 100)}
                  </TableCell>
                  <TableCell className="text-right">
                    {invoice.url ? (
                      <Button variant="ghost" size="sm" asChild>
                        <a href={invoice.url} target="_blank" rel="noreferrer">
                          <FileText className="h-3.5 w-3.5" /> PDF <ExternalLink className="h-3 w-3" />
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
