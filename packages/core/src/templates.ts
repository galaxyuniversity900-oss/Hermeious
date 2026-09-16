import type { CapabilityTemplate } from './composer.js';

export const defaultCapabilityTemplates: CapabilityTemplate[] = [
  {
    id: 'report.create',
    description: 'Research, write, format and validate a report',
    requires: ['topic'],
    produces: ['pdf'],
    steps: [
      { id: 'research', capability: 'research.search' },
      { id: 'write', capability: 'content.write', dependsOn: ['research'] },
      { id: 'pdf', capability: 'document.pdf', dependsOn: ['write'] },
      { id: 'validate', capability: 'document.validate', dependsOn: ['pdf'] }
    ]
  },
  {
    id: 'book.create',
    description: 'Research and package a book',
    requires: ['topic'],
    produces: ['docx', 'pdf'],
    steps: [
      { id: 'research', capability: 'research.search' },
      { id: 'outline', capability: 'content.outline', dependsOn: ['research'] },
      { id: 'write', capability: 'content.write', dependsOn: ['outline'] },
      { id: 'docx', capability: 'document.docx', dependsOn: ['write'] },
      { id: 'pdf', capability: 'document.pdf', dependsOn: ['docx'] },
      { id: 'validate', capability: 'document.validate', dependsOn: ['pdf'] }
    ]
  },
  {
    id: 'video.create',
    description: 'Create a media pipeline from script to final video',
    requires: ['topic', 'style'],
    produces: ['video'],
    steps: [
      { id: 'script', capability: 'content.script' },
      { id: 'storyboard', capability: 'video.storyboard', dependsOn: ['script'] },
      { id: 'visuals', capability: 'image.generate', dependsOn: ['storyboard'] },
      { id: 'video', capability: 'video.generate', dependsOn: ['visuals', 'script'] },
      { id: 'voice', capability: 'audio.tts', dependsOn: ['script'] },
      { id: 'compose', capability: 'video.compose', dependsOn: ['video', 'voice'] },
      { id: 'validate', capability: 'video.validate', dependsOn: ['compose'] }
    ]
  }
];
