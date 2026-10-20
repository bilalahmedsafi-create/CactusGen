import type { Metadata } from "next";
import CreateLoader from "@/components/create/CreateLoader";

export const metadata: Metadata = {
  title: "Create image · HeliosGen",
  description: "Pick a model, write a prompt, add reference pictures and generate an image.",
};

export default function CreateImagePage() {
  return <CreateLoader mode="image" />;
}
