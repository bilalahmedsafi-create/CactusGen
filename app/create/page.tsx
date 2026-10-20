import type { Metadata } from "next";
import CreateLoader from "@/components/create/CreateLoader";

export const metadata: Metadata = {
  title: "Create video · CactusGen",
  description: "Pick a model, drop an image, write a prompt and generate a video.",
};

export default function CreatePage() {
  return <CreateLoader mode="video" />;
}
