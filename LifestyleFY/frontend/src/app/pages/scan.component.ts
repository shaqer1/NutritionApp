import {
  AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { ApiService } from '../core/api.service';
import { FoodItem, InventoryItem } from '../core/models';
import { defaultLocation } from '../core/categories';

@Component({
  selector: 'app-scan',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1>Scan</h1>
    <div class="card">
      <video #video playsinline></video>
      <div class="row" style="margin-top:10px">
        @if (!scanning) {
          <button (click)="start()">Start camera</button>
        } @else {
          <button class="ghost" (click)="stop()">Stop</button>
        }
      </div>
      <p class="muted">{{ status }}</p>

      <label>…or enter a barcode / product name manually</label>
      <div class="row">
        <input [(ngModel)]="manual" placeholder="e.g. 3017620422003 or 'greek yogurt'" />
        <button class="ghost" (click)="lookupManual()">Find</button>
      </div>
    </div>

    @if (found) {
      <div class="card green">
        <h3>{{ found.name }}</h3>
        <p class="muted">
          {{ found.per_serving.cal | number:'1.0-0' }} kcal ·
          {{ found.per_serving.protein | number:'1.0-0' }}p ·
          {{ found.per_serving.carbs | number:'1.0-0' }}c ·
          {{ found.per_serving.fat | number:'1.0-0' }}f
          <span> · via {{ found.source }}</span>
        </p>
        <div class="row">
          <input type="number" [(ngModel)]="qty" min="1" style="max-width:90px" />
          <button class="green" (click)="addToPantry()">Add to pantry</button>
          <button class="ghost" (click)="logNow()">Log as eaten</button>
        </div>
      </div>
    }

    @if (results.length) {
      <div class="card">
        <h3>Search results</h3>
        @for (r of results; track r.name) {
          <div class="row spread" style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div>
              <div>{{ r.name }}</div>
              <div class="muted">{{ r.per_serving.cal | number:'1.0-0' }} kcal ·
                {{ r.per_serving.protein | number:'1.0-0' }}g protein</div>
            </div>
            <button class="ghost" (click)="pick(r)">Pick</button>
          </div>
        }
      </div>
    }
  `,
})
export class ScanComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  private api = inject(ApiService);
  private router = inject(Router);
  private reader = new BrowserMultiFormatReader();
  private controls?: IScannerControls;

  scanning = false;
  status = 'Point the camera at a barcode, or type one below.';
  manual = '';
  qty = 1;
  found?: FoodItem;
  results: FoodItem[] = [];

  ngAfterViewInit(): void {}

  async start(): Promise<void> {
    this.scanning = true;
    this.status = 'Starting camera…';
    try {
      this.controls = await this.reader.decodeFromVideoDevice(
        undefined, this.videoRef.nativeElement, (result, _err, controls) => {
          if (result) {
            controls.stop();
            this.scanning = false;
            this.onBarcode(result.getText());
          }
        });
    } catch {
      this.scanning = false;
      this.status = 'Camera unavailable — use manual entry. (Camera needs HTTPS or localhost.)';
    }
  }

  stop(): void {
    this.controls?.stop();
    this.scanning = false;
    this.status = 'Stopped.';
  }

  private onBarcode(code: string): void {
    this.status = `Looking up ${code}…`;
    this.api.scan(code).subscribe({
      next: (r) => { this.found = r.item; this.status = `Found via ${r.source}.`; },
      error: () => { this.status = `No match for ${code}. Try manual entry.`; },
    });
  }

  lookupManual(): void {
    const v = this.manual.trim();
    if (!v) return;
    if (/^\d{6,}$/.test(v)) { this.onBarcode(v); return; }
    this.api.search(v).subscribe({
      next: (r) => { this.results = r.results; this.status =
        r.results.length ? '' : 'No results — enter macros in the Log tab.'; },
      error: () => (this.status = 'Search failed.'),
    });
  }

  pick(item: FoodItem): void { this.found = item; this.results = []; }

  addToPantry(): void {
    if (!this.found) return;
    const item: InventoryItem = {
      ...this.found, qty: this.qty, unit: 'unit', item_id: null,
      location: defaultLocation(this.found.category),
    };
    this.api.addInventory(item).subscribe(() => {
      this.status = `Added ${this.found!.name} to pantry.`;
      this.found = undefined;
    });
  }

  logNow(): void {
    if (!this.found) return;
    this.api.log({
      meal: 'snack', item_name: this.found.name, barcode: this.found.barcode ?? null,
      source: this.found.source, servings: this.qty, macros: this.found.per_serving,
    }).subscribe(() => this.router.navigate(['/today']));
  }

  ngOnDestroy(): void { this.controls?.stop(); }
}
