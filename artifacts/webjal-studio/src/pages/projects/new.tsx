import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useListTemplates, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ArrowRight, CheckCircle2, Code2, Loader2, X, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CATEGORIES } from "@/lib/constants";
import { FileUpload, GalleryUpload } from "@/components/file-upload";

const formSchema = z.object({
  businessName: z.string().min(1, "Business name is required"),
  category: z.string().min(1, "Category is required"),
  tagline: z.string().optional(),
  about: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  googleMapsLink: z.string().optional(),
  instagramLink: z.string().optional(),
  ctaText: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  logoUrl: z.string().optional(),
  heroImageUrl: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function ProjectNew() {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [newService, setNewService] = useState("");
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: templates, isLoading: templatesLoading } = useListTemplates();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      businessName: "",
      category: "",
      tagline: "",
      about: "",
      phone: "",
      whatsapp: "",
      email: "",
      address: "",
      googleMapsLink: "",
      instagramLink: "",
      ctaText: "Get In Touch",
      primaryColor: "#4f46e5",
      secondaryColor: "#7c3aed",
      logoUrl: "",
      heroImageUrl: "",
    },
  });

  const createMutation = useCreateProject({
    mutation: {
      onSuccess: (project) => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project created successfully" });
        setLocation(`/projects/${project.id}`);
      },
      onError: () => toast({ title: "Failed to create project", variant: "destructive" }),
    },
  });

  function onSubmit(values: FormValues) {
    createMutation.mutate({
      data: {
        ...values,
        services,
        packages: [],
        galleryImages,
        templateId: selectedTemplateId ?? undefined,
      },
    });
  }

  return (
    <div className="p-8 space-y-6 flex-1 overflow-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => step === 2 ? setStep(1) : setLocation("/projects")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Demo Project</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Step {step} of 2 — {step === 1 ? "Select a Template" : "Client Details"}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 max-w-xs">
        <div className={`flex items-center gap-2 text-sm font-medium ${step >= 1 ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs ${step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>1</div>
          Template
        </div>
        <div className="flex-1 h-px bg-border" />
        <div className={`flex items-center gap-2 text-sm font-medium ${step >= 2 ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs ${step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>2</div>
          Details
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">Choose a template to base this demo on, or skip to fill in details without a template.</p>

          {templatesLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
            </div>
          ) : !templates || templates.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Code2 className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="font-medium">No templates available</p>
                <p className="text-sm text-muted-foreground mb-4">Create a template first, or continue without one.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {templates.map((template) => (
                <Card
                  key={template.id}
                  data-testid={`card-select-template-${template.id}`}
                  className={`cursor-pointer transition-all ${selectedTemplateId === template.id ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50 hover:shadow-md"}`}
                  onClick={() => setSelectedTemplateId(template.id === selectedTemplateId ? null : template.id)}
                >
                  {template.thumbnailUrl ? (
                    <div className="h-32 overflow-hidden rounded-t-lg">
                      <img src={template.thumbnailUrl} alt={template.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="h-32 rounded-t-lg bg-gradient-to-br from-primary/10 to-purple-600/10 flex items-center justify-center">
                      <Code2 className="h-8 w-8 text-primary/30" />
                    </div>
                  )}
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{template.name}</CardTitle>
                      {selectedTemplateId === template.id && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    </div>
                    <Badge variant="secondary" className="w-fit text-xs">{template.category}</Badge>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={() => setStep(2)}
              className="gap-2"
              data-testid="button-next-step"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
            {selectedTemplateId === null && (
              <span className="text-xs text-muted-foreground">No template selected — you can still fill in client details</span>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Business Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="businessName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Business Name *</FormLabel>
                        <FormControl><Input placeholder="e.g. Radiance Salon" {...field} data-testid="input-business-name" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="category" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Category *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-project-category">
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {CATEGORIES.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="tagline" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tagline</FormLabel>
                      <FormControl><Input placeholder="Your transformation, our passion" {...field} data-testid="input-tagline" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="about" render={({ field }) => (
                    <FormItem>
                      <FormLabel>About Business</FormLabel>
                      <FormControl><Textarea placeholder="Brief description of the business..." rows={3} {...field} data-testid="textarea-about" /></FormControl>
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Contact Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="phone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl><Input placeholder="+91 98765 43210" {...field} data-testid="input-phone" /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="whatsapp" render={({ field }) => (
                      <FormItem>
                        <FormLabel>WhatsApp</FormLabel>
                        <FormControl><Input placeholder="+91 98765 43210" {...field} data-testid="input-whatsapp" /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input placeholder="hello@business.com" {...field} data-testid="input-email" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="address" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl><Input placeholder="123 Main Street, City" {...field} data-testid="input-address" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="googleMapsLink" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Google Maps Link</FormLabel>
                      <FormControl><Input placeholder="https://maps.google.com/..." {...field} data-testid="input-maps" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="instagramLink" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Instagram Link</FormLabel>
                      <FormControl><Input placeholder="https://instagram.com/..." {...field} data-testid="input-instagram" /></FormControl>
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Services</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={newService}
                      onChange={(e) => setNewService(e.target.value)}
                      placeholder="Add a service..."
                      data-testid="input-new-service"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (newService.trim()) {
                            setServices([...services, newService.trim()]);
                            setNewService("");
                          }
                        }
                      }}
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => {
                      if (newService.trim()) {
                        setServices([...services, newService.trim()]);
                        setNewService("");
                      }
                    }}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {services.map((s, i) => (
                      <Badge key={i} variant="secondary" className="gap-1">
                        {s}
                        <button type="button" onClick={() => setServices(services.filter((_, j) => j !== i))}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Gallery Images</CardTitle>
                  <p className="text-sm text-muted-foreground">Upload photos or paste URLs to populate the website gallery.</p>
                </CardHeader>
                <CardContent>
                  <GalleryUpload images={galleryImages} onChange={setGalleryImages} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Design</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="primaryColor" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Primary Color</FormLabel>
                        <FormControl>
                          <div className="flex items-center gap-2">
                            <input type="color" value={field.value} onChange={field.onChange} className="h-9 w-12 rounded border cursor-pointer" data-testid="input-primary-color" />
                            <Input value={field.value} onChange={field.onChange} className="flex-1 font-mono text-sm" />
                          </div>
                        </FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="secondaryColor" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secondary Color</FormLabel>
                        <FormControl>
                          <div className="flex items-center gap-2">
                            <input type="color" value={field.value} onChange={field.onChange} className="h-9 w-12 rounded border cursor-pointer" data-testid="input-secondary-color" />
                            <Input value={field.value} onChange={field.onChange} className="flex-1 font-mono text-sm" />
                          </div>
                        </FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="ctaText" render={({ field }) => (
                    <FormItem>
                      <FormLabel>CTA Button Text</FormLabel>
                      <FormControl><Input placeholder="Get In Touch" {...field} data-testid="input-cta-text" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="logoUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Logo</FormLabel>
                      <FormControl>
                        <FileUpload value={field.value ?? ""} onChange={field.onChange} placeholder="Logo URL..." />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="heroImageUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hero Image</FormLabel>
                      <FormControl>
                        <FileUpload value={field.value ?? ""} onChange={field.onChange} placeholder="Hero image URL..." />
                      </FormControl>
                    </FormItem>
                  )} />
                </CardContent>
              </Card>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" className="gap-2" disabled={createMutation.isPending} data-testid="button-create-project">
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Project
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                Back to Template
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}
