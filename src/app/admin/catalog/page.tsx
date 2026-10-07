import { AdminCatalog } from "@/components/app/admin-catalog";
import { readCatalogAdminAction } from "@/lib/billing/catalog-backend/actions";
export default async function Page(){return <AdminCatalog initial={await readCatalogAdminAction()}/>;}
