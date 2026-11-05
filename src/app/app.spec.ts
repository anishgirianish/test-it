import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentRef.instance.rowCount.set(1_000);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });
});
