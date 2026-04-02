# Tailwind CSS Advanced Layout Techniques

## CSS Grid Mastery

### Complex Grid Layouts

```html
<!-- Holy Grail Layout -->
<div class="grid min-h-screen grid-rows-[auto_1fr_auto]">
  <header class="bg-white shadow">Header</header>
  <div class="grid grid-cols-[250px_1fr_300px]">
    <aside class="bg-gray-50 p-4">Sidebar</aside>
    <main class="p-6">Main Content</main>
    <aside class="bg-gray-50 p-4">Right Sidebar</aside>
  </div>
  <footer class="bg-gray-800 text-white">Footer</footer>
</div>

<!-- Responsive Holy Grail -->
<div class="grid min-h-screen grid-rows-[auto_1fr_auto]">
  <header>Header</header>
  <div class="grid grid-cols-1 md:grid-cols-[250px_1fr] lg:grid-cols-[250px_1fr_300px]">
    <aside class="order-2 md:order-1">Sidebar</aside>
    <main class="order-1 md:order-2">Main</main>
    <aside class="order-3 hidden lg:block">Right</aside>
  </div>
  <footer>Footer</footer>
</div>
```

### Grid Template Areas

```css
@utility grid-areas-dashboard {
  grid-template-areas:
    "header header header"
    "nav main aside"
    "nav footer footer";
}

@utility area-header { grid-area: header; }
@utility area-nav { grid-area: nav; }
@utility area-main { grid-area: main; }
@utility area-aside { grid-area: aside; }
@utility area-footer { grid-area: footer; }
```

```html
<div class="grid grid-areas-dashboard grid-cols-[200px_1fr_250px] grid-rows-[60px_1fr_40px] min-h-screen">
  <header class="area-header bg-white shadow">Header</header>
  <nav class="area-nav bg-gray-100">Navigation</nav>
  <main class="area-main p-6">Main Content</main>
  <aside class="area-aside bg-gray-50 p-4">Sidebar</aside>
  <footer class="area-footer bg-gray-800 text-white">Footer</footer>
</div>
```

### Auto-Fill and Auto-Fit Grids

```html
<!-- Auto-fill: Creates as many tracks as fit, even empty ones -->
<div class="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-6">
  <div class="bg-white rounded-lg shadow p-4">Card 1</div>
  <div class="bg-white rounded-lg shadow p-4">Card 2</div>
  <div class="bg-white rounded-lg shadow p-4">Card 3</div>
</div>

<!-- Auto-fit: Collapses empty tracks -->
<div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-6">
  <!-- Cards stretch to fill available space -->
</div>

<!-- With arbitrary values -->
<div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4">
  <!-- Handles edge case where container is smaller than minmax min -->
</div>
```

## Advanced Flexbox Patterns

### Flexible Item Sizing

```html
<!-- Items share space equally -->
<div class="flex">
  <div class="flex-1">1/3</div>
  <div class="flex-1">1/3</div>
  <div class="flex-1">1/3</div>
</div>

<!-- First item takes 2x space -->
<div class="flex">
  <div class="flex-[2]">2/4</div>
  <div class="flex-1">1/4</div>
  <div class="flex-1">1/4</div>
</div>

<!-- Fixed + flexible -->
<div class="flex">
  <div class="w-64 shrink-0">Fixed 256px</div>
  <div class="flex-1 min-w-0">Flexible (can shrink)</div>
</div>

<!-- Prevent shrinking with text overflow -->
<div class="flex min-w-0">
  <div class="shrink-0">Icon</div>
  <div class="min-w-0 truncate">Very long text that should truncate</div>
</div>
```

## Container Queries

```html
<!-- Define container -->
<div class="@container">
  <!-- Respond to container width -->
  <div class="flex flex-col @md:flex-row @lg:grid @lg:grid-cols-3 gap-4">
    <div>Item 1</div>
    <div>Item 2</div>
    <div>Item 3</div>
  </div>
</div>

<!-- Named containers -->
<div class="@container/sidebar">
  <nav class="@[200px]/sidebar:flex-col @[300px]/sidebar:flex-row">
    Navigation
  </nav>
</div>
```

## Position and Layering

### Sticky Positioning

```html
<!-- Sticky header -->
<header class="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b">
  Navigation
</header>

<!-- Sticky sidebar -->
<aside class="sticky top-20 h-[calc(100vh-5rem)] overflow-auto">
  Sidebar content
</aside>
```

### Z-Index Management

```css
@theme {
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-fixed: 300;
  --z-modal-backdrop: 400;
  --z-modal: 500;
  --z-popover: 600;
  --z-tooltip: 700;
  --z-toast: 800;
}
```

## Scroll Snap

```html
<!-- Horizontal carousel -->
<div class="flex snap-x snap-mandatory overflow-x-auto gap-4 pb-4">
  <div class="snap-start shrink-0 w-80">Card 1</div>
  <div class="snap-start shrink-0 w-80">Card 2</div>
  <div class="snap-start shrink-0 w-80">Card 3</div>
</div>

<!-- Full-page sections -->
<div class="h-screen snap-y snap-mandatory overflow-y-auto">
  <section class="h-screen snap-start">Section 1</section>
  <section class="h-screen snap-start">Section 2</section>
</div>
```

## Fluid Sizing with Clamp

```html
<!-- Fluid padding -->
<section class="py-[clamp(2rem,5vw,6rem)] px-[clamp(1rem,3vw,4rem)]">
  Content with responsive padding
</section>

<!-- Fluid max-width -->
<div class="mx-auto w-full max-w-[clamp(300px,90vw,1200px)]">
  Responsive container
</div>
```

## Best Practices

### 1. Use Modern Layout Methods
```html
<!-- Prefer Grid for 2D layouts -->
<div class="grid grid-cols-3 gap-4">

<!-- Prefer Flexbox for 1D layouts -->
<div class="flex items-center gap-2">
```

### 2. Handle Edge Cases
```html
<!-- Prevent flex item from overflowing -->
<div class="flex min-w-0">
  <div class="min-w-0 truncate">Long text</div>
</div>

<!-- Prevent grid blowout -->
<div class="grid grid-cols-1 min-w-0">
  <div class="overflow-hidden">Content that might overflow</div>
</div>
```

### 3. Use Semantic Sizing
```html
<!-- Prefer max-w-prose for reading content -->
<article class="max-w-prose mx-auto">

<!-- Use container for page sections -->
<div class="container mx-auto px-4">
```
